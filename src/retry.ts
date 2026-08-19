import { DEFAULTS } from "./config.js";
import type { HttpMethod, RetryConfig, RetryOption } from "./types.js";

export type ResolvedRetry = Required<RetryConfig>;

type CanRetryInput = {
    attempt: number;
    config: ResolvedRetry | null;
    method: HttpMethod;
    replayable: boolean;
};

type GetBackoffDelayInput = {
    attempt: number;
    config: ResolvedRetry;
};

type GetRetryDelayInput = GetBackoffDelayInput & {
    response: Response;
};

const assertNumber = (name: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative number`);
    }
};

export const resolveRetry = (retry?: RetryOption): ResolvedRetry | null => {
    if (retry === false || retry === undefined || retry === 0) return null;

    const input = typeof retry === "number" ? { limit: retry } : retry;
    const config: ResolvedRetry = {
        baseDelay: input.baseDelay ?? DEFAULTS.retry.baseDelay,
        jitter: input.jitter ?? DEFAULTS.retry.jitter,
        limit: input.limit ?? DEFAULTS.retry.limit,
        maxDelay: input.maxDelay ?? DEFAULTS.retry.maxDelay,
        methods: input.methods ?? DEFAULTS.retry.methods,
        statusCodes: input.statusCodes ?? DEFAULTS.retry.statusCodes,
    };

    assertNumber("retry.limit", config.limit);
    assertNumber("retry.baseDelay", config.baseDelay);
    assertNumber("retry.maxDelay", config.maxDelay);

    return config;
};

export const canRetry = ({ attempt, config, method, replayable }: CanRetryInput) =>
    Boolean(config && replayable && attempt <= config.limit && config.methods.includes(method));

const retryAfter = (response: Response) => {
    const value = response.headers.get("retry-after");

    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

export const getBackoffDelay = ({ attempt, config }: GetBackoffDelayInput) => {
    const backoff = config.baseDelay * 2 ** (attempt - 1);
    const base = Math.min(backoff, config.maxDelay);

    return config.jitter ? Math.round(Math.random() * base) : base;
};

export const getRetryDelay = ({ attempt, config, response }: GetRetryDelayInput) => {
    const headerDelay = retryAfter(response);

    if (headerDelay !== null) {
        return headerDelay <= config.maxDelay ? headerDelay : null;
    }

    return getBackoffDelay({ attempt, config });
};

export const sleep = (delay: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        const getError = () =>
            signal.reason instanceof Error
                ? signal.reason
                : new DOMException("The operation was aborted", "AbortError");

        if (signal.aborted) {
            reject(getError());
            return;
        }

        const abort = () => {
            clearTimeout(timer);
            reject(getError());
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, delay);

        signal.addEventListener("abort", abort, { once: true });
    });
