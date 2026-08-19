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
