import { DEFAULTS, FORWARD_HEADERS } from "./config.js";
import { HTTPError, NetworkError, TimeoutError } from "./errors.js";
import { getBodySize, getContentLength, trackResponse, trackStream } from "./progress.js";
import { canRetry, getBackoffDelay, getRetryDelay, resolveRetry, sleep } from "./retry.js";
import type {
    Fetcher,
    FetcherConfig,
    FetchTask,
    HttpMethod,
    RequestInput,
    RequestOptions,
    ResponseContext,
    RuntimeBaseUrl,
} from "./types.js";
import { resolveUrl } from "./url.js";

type StreamRequestInit = RequestInit & {
    duplex: "half";
};

type BuildRequestInput = {
    config: FetcherConfig;
    forwardedHeaders?: Headers | undefined;
    input: RequestInput;
    method: HttpMethod;
    options: RequestOptions;
    signal: AbortSignal;
};

type Operation = {
    cleanup: () => void;
    didTimeout: () => boolean;
    signal: AbortSignal;
    timeout: false | number;
};

const CONFIG_KEYS = new Set([
    "afterResponse",
    "baseUrl",
    "beforeRequest",
    "forwardHeaders",
    "getHeaders",
    "headers",
    "onError",
    "onRetry",
    "onStatus",
    "prefix",
    "retry",
    "searchParams",
    "throwHttpErrors",
    "timeout",
]);

const REQUEST_KEYS = new Set([
    "afterResponse",
    "beforeRequest",
    "headers",
    "json",
    "onDownloadProgress",
    "onError",
    "onRetry",
    "onStatus",
    "onUploadProgress",
    "retry",
    "searchParams",
    "throwHttpErrors",
    "timeout",
]);

const toError = (error: unknown) => {
    return error instanceof Error ? error : new Error("Request failed", { cause: error });
};

const isStream = (body: BodyInit | null | undefined): body is ReadableStream => {
    return typeof ReadableStream !== "undefined" && body instanceof ReadableStream;
};

const isRuntimeBaseUrl = (baseUrl: FetcherConfig["baseUrl"]): baseUrl is RuntimeBaseUrl => {
    return typeof baseUrl === "object" && !(baseUrl instanceof URL);
};

const getBaseUrl = (baseUrl: FetcherConfig["baseUrl"]) => {
    if (!isRuntimeBaseUrl(baseUrl)) return baseUrl;

    return typeof window === "undefined" ? baseUrl.server : baseUrl.client;
};

const getForwardedHeaders = async (config: FetcherConfig) => {
    if (!config.forwardHeaders || typeof window !== "undefined") return undefined;
    if (!config.getHeaders) {
        throw new TypeError("getHeaders is required when forwardHeaders is enabled on the server");
    }

    const source = new Headers(await config.getHeaders());
    const names = new Set<string>(FORWARD_HEADERS);

    if (typeof config.forwardHeaders === "object") {
        for (const name of config.forwardHeaders.extra) {
            const normalized = name.trim().toLowerCase();
            if (normalized) names.add(normalized);
        }
    }

    const headers = new Headers();

    for (const name of names) {
        const value = source.get(name);
        if (value?.trim()) headers.set(name, value);
    }

    return headers;
};

const mergeHeaders = (...values: (HeadersInit | undefined)[]) => {
    const headers = new Headers();

    for (const value of values) {
        if (!value) continue;
        for (const [name, headerValue] of new Headers(value)) headers.set(name, headerValue);
    }

    return headers;
};

const getInit = (value: FetcherConfig | RequestOptions, keys: Set<string>) => {
    return Object.fromEntries(
        Object.entries(value).filter(([key]) => !keys.has(key)),
    ) as RequestInit;
};

const getBody = (options: RequestOptions, headers: Headers) => {
    if (!("json" in options)) return options.body;
    if (options.body !== null && options.body !== undefined) {
        throw new TypeError("json and body cannot be used together");
    }

    if (options.json === undefined) throw new TypeError("json cannot be undefined");

    const body: unknown = JSON.stringify(options.json);
    if (typeof body !== "string") throw new TypeError("json must be serializable");

    if (!headers.has("content-type")) headers.set("content-type", "application/json");

    return body;
};

const buildRequest = ({
    config,
    forwardedHeaders,
    input,
    method,
    options,
    signal,
}: BuildRequestInput) => {
    if (input instanceof Request && options.searchParams !== undefined) {
        throw new TypeError("searchParams cannot be combined with a Request input");
    }

    const requestInput =
        input instanceof Request
            ? input
            : resolveUrl({
                  baseUrl: getBaseUrl(config.baseUrl),
                  input,
                  prefix: config.prefix,
                  requestSearchParams: options.searchParams,
                  searchParams: config.searchParams,
              });

    const inputHeaders = input instanceof Request ? input.headers : undefined;
    const headers = mergeHeaders(forwardedHeaders, config.headers, inputHeaders, options.headers);
    const body = getBody(options, headers);
    const hasBody = body !== undefined || "body" in options;

    const init: RequestInit = {
        ...getInit(config, CONFIG_KEYS),
        ...getInit(options, REQUEST_KEYS),
        headers,
        method,
        signal,
        ...(hasBody ? { body } : {}),
    };

    const requestInit: RequestInit = isStream(body)
        ? ({ ...init, duplex: "half" } as StreamRequestInit)
        : init;
    let request = new Request(requestInput, requestInit);

    if (options.onUploadProgress && request.body) {
        const total = getBodySize(body) ?? getContentLength(request.headers);

        const tracked = trackStream({
            onProgress: options.onUploadProgress,
            stream: request.body,
            total,
        });

        const trackedInit: RequestInit = {
            body: tracked,
            duplex: "half",
        } as StreamRequestInit;
        request = new Request(request, trackedInit);
    }

    return { replayable: !isStream(body) && !(input instanceof Request && input.body), request };
};

const createOperation = ({
    signal,
    timeout,
}: {
    signal?: AbortSignal | null | undefined;
    timeout: false | number;
}): Operation => {
    if (timeout !== false && (!Number.isFinite(timeout) || timeout <= 0)) {
        throw new TypeError("timeout must be a positive number or false");
    }

    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const abort = () => controller.abort(signal?.reason);

    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    if (timeout !== false) {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeout);
    }

    return {
        cleanup: () => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
        },
        didTimeout: () => timedOut,
        signal: controller.signal,
        timeout,
    };
};

class Task implements FetchTask {
    readonly #promise: Promise<Response>;

    constructor(run: () => Promise<Response>) {
        this.#promise = run();
    }

    then<TResult1 = Response, TResult2 = never>(
        onFulfilled?: ((value: Response) => PromiseLike<TResult1> | TResult1) | null,
        onRejected?: ((reason: unknown) => PromiseLike<TResult2> | TResult2) | null,
    ) {
        return this.#promise.then(onFulfilled, onRejected);
    }

    catch<TResult = never>(
        onRejected?: ((reason: unknown) => PromiseLike<TResult> | TResult) | null,
    ) {
        return this.#promise.catch(onRejected);
    }

    finally(onFinally?: (() => void) | null) {
        return this.#promise.finally(onFinally ?? undefined);
    }

    response() {
        return this.#promise;
    }

    async json<T = unknown>() {
        return (await this.#promise).json() as Promise<T>;
    }

    async text() {
        return (await this.#promise).text();
    }

    async blob() {
        return (await this.#promise).blob();
    }

    async arrayBuffer() {
        return (await this.#promise).arrayBuffer();
    }

    async formData() {
        return (await this.#promise).formData();
    }
}

const createMethod =
    (config: FetcherConfig, method: HttpMethod) =>
    (input: RequestInput = "", options: RequestOptions = {}) =>
        new Task(async () => {
            const timeout = options.timeout ?? config.timeout ?? DEFAULTS.timeout;
            const retry = resolveRetry(options.retry ?? config.retry);

            const operation = createOperation({
                signal: options.signal ?? (input instanceof Request ? input.signal : undefined),
                timeout,
            });

            const beforeRequest = options.beforeRequest ?? config.beforeRequest;
            const afterResponse = options.afterResponse ?? config.afterResponse;
            const onRetry = options.onRetry ?? config.onRetry;
            const onError = options.onError ?? config.onError;
            const onStatus = options.onStatus ?? config.onStatus;

            const throwHttpErrors =
                options.throwHttpErrors ?? config.throwHttpErrors ?? DEFAULTS.throwHttpErrors;

            let attempt = 0;
            let lastRequest: Request | null = null;

            const handleError = async (error: unknown) => {
                const current = toError(error);
                const changed = await onError?.({ attempt, error: current, request: lastRequest });
                return changed ?? current;
            };
            const getTimeoutError = () =>
                new TimeoutError(operation.timeout === false ? 0 : operation.timeout, lastRequest);

            try {
                let forwardedHeaders: Headers | undefined;

                try {
                    forwardedHeaders = await getForwardedHeaders(config);
                } catch (error) {
                    throw await handleError(error);
                }

                if (operation.didTimeout()) throw await handleError(getTimeoutError());

                for (;;) {
                    attempt += 1;
                    const built = buildRequest({
                        config,
                        forwardedHeaders,
                        input,
                        method,
                        options,
                        signal: operation.signal,
                    });
                    lastRequest = built.request;

                    try {
                        await beforeRequest?.({ attempt, request: built.request });
                    } catch (error) {
                        throw await handleError(error);
                    }

                    let response: Response;

                    try {
                        response = await fetch(built.request);
                    } catch (error) {
                        if (operation.didTimeout()) {
                            throw await handleError(getTimeoutError());
                        }
                        if (operation.signal.aborted) throw await handleError(error);

                        const networkError = new NetworkError(error, built.request);
                        if (
                            !retry ||
                            !canRetry({
                                attempt,
                                config: retry,
                                method,
                                replayable: built.replayable,
                            })
                        ) {
                            throw await handleError(networkError);
                        }

                        const delay = getBackoffDelay({ attempt, config: retry });
                        try {
                            await onRetry?.({
                                attempt,
                                delay,
                                error: networkError,
                                request: built.request,
                                response: null,
                            });
                            await sleep(delay, operation.signal);
                        } catch (retryError) {
                            throw await handleError(
                                operation.didTimeout() ? getTimeoutError() : retryError,
                            );
                        }
                        continue;
                    }

                    try {
                        response =
                            (await afterResponse?.({
                                attempt,
                                request: built.request,
                                response,
                            })) ?? response;
                    } catch (error) {
                        throw await handleError(error);
                    }

                    if (operation.didTimeout()) throw await handleError(getTimeoutError());

                    const shouldRetry =
                        retry?.statusCodes.includes(response.status) &&
                        canRetry({
                            attempt,
                            config: retry,
                            method,
                            replayable: built.replayable,
                        });

                    if (shouldRetry && retry) {
                        const delay = getRetryDelay({ attempt, config: retry, response });

                        if (delay !== null) {
                            const error = new HTTPError(response, built.request);

                            try {
                                await onRetry?.({
                                    attempt,
                                    delay,
                                    error,
                                    request: built.request,
                                    response,
                                });
                                if (response.body && !response.bodyUsed && !response.body.locked) {
                                    await response.body.cancel();
                                }
                                await sleep(delay, operation.signal);
                            } catch (retryError) {
                                throw await handleError(
                                    operation.didTimeout() ? getTimeoutError() : retryError,
                                );
                            }
                            continue;
                        }
                    }

                    response = trackResponse(response, options.onDownloadProgress);
                    const context: ResponseContext = {
                        attempt,
                        request: built.request,
                        response,
                    };

                    await onStatus?.[response.status]?.(context);

                    if (!response.ok && throwHttpErrors) {
                        throw await handleError(new HTTPError(response, built.request));
                    }

                    return response;
                }
            } finally {
                operation.cleanup();
            }
        });

export const createFetcher = (config: FetcherConfig = {}): Fetcher => ({
    delete: createMethod(config, "DELETE"),
    get: createMethod(config, "GET"),
    head: createMethod(config, "HEAD"),
    patch: createMethod(config, "PATCH"),
    post: createMethod(config, "POST"),
    put: createMethod(config, "PUT"),
});
