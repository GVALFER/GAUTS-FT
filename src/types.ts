export type HttpMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT";

export type RequestInput = Request | string | URL;

export type SearchValue = boolean | number | string | null | undefined;

export type SearchParams =
    | URLSearchParams
    | Record<string, SearchValue | readonly SearchValue[]>
    | readonly (readonly [string, SearchValue])[];

export type RuntimeBaseUrl = {
    client: string | URL;
    server: string | URL;
};

export type ForwardHeaders = boolean | { extra: readonly string[] };

export type GetHeaders = () => HeadersInit | Promise<HeadersInit>;

export type Progress = {
    percent: number | null;
    total: number | null;
    transferred: number;
};

export type RequestContext = {
    attempt: number;
    isServer: boolean;
    request: Request;
};

export type ResponseContext = RequestContext & {
    response: Response;
};

export type RetryContext = RequestContext & {
    delay: number;
    error: Error;
    response: Response | null;
};

export type ErrorContext = {
    attempt: number;
    error: Error;
    isServer: boolean;
    request: Request | null;
};

export type BeforeRequest = (context: RequestContext) => unknown;

export type AfterResponse = (
    context: ResponseContext,
) => Promise<Response | void> | Response | void;

export type OnRetry = (context: RetryContext) => unknown;

export type OnError = (context: ErrorContext) => Promise<Error | void> | Error | void;

export type OnStatus = (context: ResponseContext) => unknown;

export type StatusHandlers = Partial<Record<number, OnStatus>>;

export type RetryConfig = {
    baseDelay?: number;
    jitter?: boolean;
    limit?: number;
    maxDelay?: number;
    methods?: readonly HttpMethod[];
    statusCodes?: readonly number[];
};

export type RetryOption = RetryConfig | number | false;

type Lifecycle = {
    afterResponse?: AfterResponse;
    beforeRequest?: BeforeRequest;
    onError?: OnError;
    onRetry?: OnRetry;
    onStatus?: StatusHandlers;
};

type Reliability = {
    retry?: RetryOption;
    throwHttpErrors?: boolean;
    timeout?: false | number;
};

export type FetcherConfig = Omit<RequestInit, "body" | "method" | "signal"> &
    Lifecycle &
    Reliability & {
        baseUrl?: RuntimeBaseUrl | string | URL;
        forwardHeaders?: ForwardHeaders;
        getHeaders?: GetHeaders;
        prefix?: string;
        searchParams?: SearchParams;
    };

export type RequestOptions = Omit<RequestInit, "method"> &
    Lifecycle &
    Reliability & {
        json?: unknown;
        onDownloadProgress?: (progress: Progress) => void;
        onUploadProgress?: (progress: Progress) => void;
        searchParams?: SearchParams;
    };

export type FetchTask = PromiseLike<Response> & {
    arrayBuffer: () => Promise<ArrayBuffer>;
    blob: () => Promise<Blob>;
    catch: <TResult = never>(
        onRejected?: ((reason: unknown) => PromiseLike<TResult> | TResult) | null,
    ) => Promise<Response | TResult>;
    finally: (onFinally?: (() => void) | null) => Promise<Response>;
    formData: () => Promise<FormData>;
    json: <T = unknown>() => Promise<T>;
    response: () => Promise<Response>;
    text: () => Promise<string>;
};

export type FetchMethod = (input?: RequestInput, options?: RequestOptions) => FetchTask;

export type Fetcher = {
    delete: FetchMethod;
    get: FetchMethod;
    head: FetchMethod;
    patch: FetchMethod;
    post: FetchMethod;
    put: FetchMethod;
};

export type Ft = Fetcher & {
    create: (config?: FetcherConfig) => Fetcher;
};
