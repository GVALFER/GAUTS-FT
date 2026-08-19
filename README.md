# @gauts/ft

A small, typed HTTP client built on the native Fetch API.

- ✅ Ready-to-use default client
- ✅ Configured instances with `ft.create()`
- ✅ Typed response shortcuts
- ✅ JSON bodies and search parameters
- ✅ Timeout and opt-in retries
- ✅ Typed HTTP, network, and timeout errors
- ✅ Upload and download progress with native streams
- ✅ Request, response, retry, error, and status callbacks
- ✅ Automatic browser/server base URL selection
- ✅ Opt-in server header forwarding through a safe allowlist
- ✅ Native `RequestInit` options
- ✅ Zero runtime dependencies

## Installation

```bash
npm install @gauts/ft
```

Node.js 22 or a modern browser with the native Fetch API is required.

## Quick start

Import the ready-to-use client:

```ts
import ft from "@gauts/ft";

type Account = {
    email: string;
    id: string;
};

const account = await ft.get("https://api.example.com/accounts/123").json<Account>();
```

Or create a configured instance:

```ts
import ft from "@gauts/ft";

export const api = ft.create({
    baseUrl: "https://api.example.com",
    headers: {
        accept: "application/json",
    },
    prefix: "v1",
});

const account = await api.get("accounts/123").json<Account>();
```

The resulting URL is `https://api.example.com/v1/accounts/123`.

For applications with separate browser and server paths:

```ts
const api = ft.create({
    baseUrl: {
        client: "/proxy",
        server: "http://api:4000",
    },
});
```

The browser uses `client`; Node.js and other runtimes without `window` use `server`.

## Methods

All methods accept an optional URL and request options:

```ts
ft.get(url, options);
ft.post(url, options);
ft.put(url, options);
ft.patch(url, options);
ft.delete(url, options);
ft.head(url, options);
```

Calling a method starts one request operation and returns a `FetchTask`. The task can be awaited as a native `Response` or consumed through a body shortcut.

```ts
const response = await api.get("accounts/123");
const sameResponse = await api.get("accounts/123").response();
```

## Request bodies

Use `json` to serialize a JSON body and set `content-type: application/json` when it is not already configured:

```ts
const account = await api
    .post("accounts", {
        json: {
            email: "user@example.com",
            name: "Example User",
        },
    })
    .json<Account>();
```

Use `body` for any native `BodyInit` value:

```ts
const form = new FormData();
form.set("avatar", file);

const account = await api
    .post("accounts/avatar", {
        body: form,
    })
    .json<Account>();
```

`json` and `body` are mutually exclusive.

## Search parameters

Search parameters can be configured on the instance and overridden per request:

```ts
const api = ft.create({
    baseUrl: "https://api.example.com",
    searchParams: {
        locale: "en",
    },
});

const accounts = await api
    .get("accounts", {
        searchParams: {
            page: 2,
            role: ["OWNER", "ADMIN"],
        },
    })
    .json<Account[]>();
```

Supported values are strings, numbers, booleans, `null`, `undefined`, and arrays of those values. `null` and `undefined` are omitted. Request parameters replace instance parameters with the same name.

## Response shortcuts

```ts
api.get("data").json<MyType>();
api.get("data").text();
api.get("data").blob();
api.get("data").arrayBuffer();
api.get("data").bytes();
api.get("data").formData();
api.get("data").response();
```

`json<T>()` defaults to `unknown`. The generic type provides compile-time typing only; it does not validate the response at runtime. Empty or invalid JSON rejects with the native parsing error.

## Configuration

### Instance options

| Property          | Type                             | Default | Description                                           |
| ----------------- | -------------------------------- | ------- | ----------------------------------------------------- |
| `baseUrl`         | `string \| URL \| RuntimeBaseUrl` | —       | Static URL or automatic client/server URLs.           |
| `prefix`          | `string`                         | —       | Path inserted between `baseUrl` and the request path. |
| `searchParams`    | `SearchParams`                   | —       | Parameters included in every request.                 |
| `headers`         | `HeadersInit`                    | —       | Headers included in every request.                    |
| `forwardHeaders`  | `boolean \| { extra: string[] }` | `false` | Forwards allowlisted incoming headers on the server.  |
| `getHeaders`      | `() => HeadersInit \| Promise<HeadersInit>` | — | Provides the current incoming server headers.     |
| `timeout`         | `number \| false`                | `false` | Request timeout in milliseconds.                      |
| `retry`           | `number \| RetryConfig \| false` | `false` | Enables retries. A number is the retry limit.         |
| `throwHttpErrors` | `boolean`                        | `true`  | Throws `HTTPError` for non-2xx responses.             |
| `beforeRequest`   | `BeforeRequest`                  | —       | Runs before every attempt.                            |
| `afterResponse`   | `AfterResponse`                  | —       | Runs after every received response.                   |
| `onRetry`         | `OnRetry`                        | —       | Runs before a retry delay.                            |
| `onError`         | `OnError`                        | —       | Observes or replaces the final error.                 |
| `onStatus`        | `StatusHandlers`                 | —       | Runs an action for the final response status.         |

All other native `RequestInit` properties, such as `cache`, `credentials`, `mode`, and `redirect`, are supported.

### Request options

Request options support the same reliability, lifecycle, and native options, plus:

| Property             | Type                 | Description                                                       |
| -------------------- | -------------------- | ----------------------------------------------------------------- |
| `json`               | `unknown`            | Serializes a JSON request body.                                   |
| `body`               | `BodyInit \| null`   | Sends a native request body.                                      |
| `searchParams`       | `SearchParams`       | Adds or replaces search parameters.                               |
| `signal`             | `AbortSignal`        | Cancels the request without being replaced by the timeout signal. |
| `onUploadProgress`   | `(progress) => void` | Reports native upload stream progress.                            |
| `onDownloadProgress` | `(progress) => void` | Reports native download stream progress.                          |

Request-specific lifecycle callbacks replace the matching instance callback. They are not silently chained.

## Runtime URLs and header forwarding

Runtime selection and header filtering are framework-independent. Only the function that obtains the current incoming request headers belongs to the application:

```ts
const api = ft.create({
    baseUrl: {
        client: "/proxy",
        server: process.env.API_URL!,
    },

    getHeaders: async () => {
        const { headers } = await import("next/headers");
        return headers();
    },

    forwardHeaders: true,
});
```

`forwardHeaders: true` enables the built-in allowlist:

```text
accept-language
cf-connecting-ip
origin
referer
sec-ch-ua
sec-ch-ua-mobile
sec-ch-ua-platform
sec-fetch-dest
sec-fetch-mode
sec-fetch-site
sec-fetch-user
true-client-ip
user-agent
x-forwarded-for
x-forwarded-host
x-forwarded-port
x-forwarded-proto
x-real-ip
```

Add application-specific headers without replacing the defaults:

```ts
const api = ft.create({
    baseUrl: {
        client: "/proxy",
        server: process.env.API_URL!,
    },
    getHeaders,
    forwardHeaders: {
        extra: ["x-tenant-id"],
    },
});
```

The property is disabled when omitted or set to `false`. On the server, enabling it without `getHeaders` throws a configuration error. In the browser, `getHeaders` is not called because the browser controls its own outgoing request headers.

`cookie` and `authorization` are intentionally excluded from the default allowlist. Add them explicitly only when the destination is trusted:

```ts
forwardHeaders: {
    extra: ["cookie", "authorization"],
}
```

Forwarded headers have the lowest priority. Instance headers, headers from an input `Request`, and request-specific headers override them in that order. `getHeaders` is called once per operation, not once per retry.

The application and its reverse proxy remain responsible for ensuring IP and forwarding headers are trustworthy before they reach the fetcher.

## Retries

Retries are disabled by default. Enable them with a number:

```ts
const api = ft.create({
    retry: 2,
});
```

Or configure them explicitly:

```ts
const api = ft.create({
    retry: {
        baseDelay: 300,
        jitter: true,
        limit: 2,
        maxDelay: 30_000,
        methods: ["GET", "HEAD"],
        statusCodes: [408, 429, 500, 502, 503, 504],
    },
});
```

Only `GET` and `HEAD` are retried by default. Add mutation methods explicitly only when the endpoint is idempotent. Request streams are never replayed or buffered silently. `Retry-After` is respected and capped by `maxDelay`.

## Timeout and cancellation

```ts
const account = await api
    .get("accounts/123", {
        timeout: 10_000,
    })
    .json<Account>();
```

The timeout covers all attempts and retry delays until the final response headers are received. A timeout throws `TimeoutError`. A user-provided `AbortSignal` remains independent and preserves its own abort reason.

## Lifecycle

```ts
const api = ft.create({
    beforeRequest: ({ attempt, request }) => {
        request.headers.set("x-attempt", String(attempt));
    },

    afterResponse: ({ response }) => {
        console.log(response.status);
    },

    onRetry: ({ attempt, delay, error }) => {
        console.log({ attempt, delay, error });
    },

    onError: ({ error }) => {
        return new Error("API request failed", { cause: error });
    },
});
```

The order is:

```text
beforeRequest
  -> fetch
  -> afterResponse
  -> onRetry (when another attempt will run)
  -> onStatus (final response only)
  -> onError (final fetcher error only)
```

`afterResponse` may return a replacement `Response`. `onError` may return a replacement `Error`.

## Status actions

`onStatus` runs after retries and before an `HTTPError` is created:

```ts
const api = ft.create({
    onStatus: {
        401: ({ response }) => {
            console.log("Unauthorized", response.url);
        },
        503: () => {
            throw new Error("Maintenance mode");
        },
    },
});
```

Errors thrown by a status action propagate unchanged and do not pass through `onError`. This allows the application to use its own routing or control-flow mechanism.

## Progress

```ts
await api
    .post("upload", {
        body: file,
        onUploadProgress: ({ percent, transferred, total }) => {
            console.log({ percent, transferred, total });
        },
    })
    .json();

await api
    .get("download", {
        onDownloadProgress: ({ percent, transferred, total }) => {
            console.log({ percent, transferred, total });
        },
    })
    .blob();
```

`total` and `percent` are `null` when the runtime or server does not provide a known size. Upload progress depends on native request stream support. The package does not switch to XMLHttpRequest or another transport.

## Errors

```ts
import { FetchError, HTTPError, NetworkError, TimeoutError } from "@gauts/ft";
```

- `HTTPError` exposes `request` and `response`.
- `NetworkError` exposes `request` and the native error through `cause`.
- `TimeoutError` exposes `request` and `timeout`.
- `FetchError` is the shared base class.

## Current scope

This version contains only the framework-independent native Fetch client. It can select browser/server URLs and filter incoming headers, but it never imports a framework or discovers a framework request context by itself. The consuming application provides that context through `getHeaders`. Authentication, session management, and application caching remain outside the package.

## License

MIT
