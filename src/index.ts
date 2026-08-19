import { createFetcher } from "./client.js";
import type { Ft } from "./types.js";

export { createFetcher } from "./client.js";
export { errorInfo, FetchError, HTTPError, NetworkError, TimeoutError } from "./errors.js";
export type { ErrorInfo } from "./errors.js";
export type {
    AfterResponse,
    BeforeRequest,
    DownloadOptions,
    ErrorContext,
    Fetcher,
    FetcherConfig,
    FetchMethod,
    FetchTask,
    Ft,
    ForwardHeaders,
    GetHeaders,
    HttpMethod,
    OnError,
    OnRetry,
    OnStatus,
    Progress,
    RequestContext,
    RequestInput,
    RequestOptions,
    ResponseContext,
    RetryConfig,
    RetryContext,
    RetryOption,
    RuntimeBaseUrl,
    SearchParams,
    SearchValue,
    StatusHandlers,
} from "./types.js";

const client = createFetcher();

const ft: Ft = {
    ...client,
    create: createFetcher,
};

export default ft;
