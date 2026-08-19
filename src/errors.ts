export type ErrorInfo = {
    code?: string;
    message: string;
    status: number;
};

const fallbackMessage = "Request failed";

const getRecord = (value: unknown): Record<string, unknown> | null => {
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const getText = (value: unknown) => {
    return typeof value === "string" && value.trim() ? value : undefined;
};

export class FetchError extends Error {
    readonly request: Request | null;

    constructor(message: string, request: Request | null, options?: ErrorOptions) {
        super(message, options);
        this.name = "FetchError";
        this.request = request;
    }
}

export class HTTPError extends FetchError {
    readonly response: Response;

    constructor(response: Response, request: Request) {
        super(
            `Request failed with status ${String(response.status)} ${response.statusText}`.trim(),
            request,
        );
        this.name = "HTTPError";
        this.response = response;
    }
}

export class NetworkError extends FetchError {
    constructor(error: unknown, request: Request | null) {
        const message = error instanceof Error ? error.message : "Network request failed";

        super(message, request, { cause: error });
        this.name = "NetworkError";
    }
}

export class TimeoutError extends FetchError {
    readonly timeout: number;

    constructor(timeout: number, request: Request | null) {
        super(`Request timed out after ${String(timeout)}ms`, request);
        this.name = "TimeoutError";
        this.timeout = timeout;
    }
}

const getBody = async (err: HTTPError) => {
    try {
        const body: unknown = await err.response.clone().json();
        return getRecord(body);
    } catch {
        return null;
    }
};

export const errorInfo = async (err: unknown): Promise<ErrorInfo> => {
    const value = getRecord(err);
    const response = getRecord(value?.response);
    const body = err instanceof HTTPError ? await getBody(err) : null;

    let status = 0;

    if (err instanceof HTTPError) status = err.response.status;
    else if (typeof value?.status === "number") status = value.status;
    else if (typeof response?.status === "number") status = response.status;

    const message =
        getText(body?.error) ??
        getText(body?.message) ??
        getText(value?.message) ??
        fallbackMessage;

    const code = getText(body?.code) ?? getText(value?.code);

    return code ? { code, message, status } : { message, status };
};
