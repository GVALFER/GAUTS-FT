import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { after, beforeEach, describe, test } from "node:test";

import ft, { HTTPError, TimeoutError } from "../src/index.js";
import { getRetryDelay, resolveRetry, sleep } from "../src/retry.js";
import { resolveUrl } from "../src/url.js";

type Echo = {
    body: string;
    headers: Record<string, string | undefined>;
    method: string;
    url: string;
};

let baseUrl = "";
let retryCount = 0;

const readBody = async (request: IncomingMessage) => {
    const chunks: Uint8Array[] = [];

    for await (const chunk of request as AsyncIterable<Uint8Array>) chunks.push(chunk);

    return Buffer.concat(chunks).toString("utf8");
};

const sendJson = (response: ServerResponse, value: unknown, status = 200) => {
    const body = JSON.stringify(value);

    response.writeHead(status, {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json",
    });
    response.end(body);
};

const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname.endsWith("/echo")) {
        sendJson(response, {
            body: await readBody(request),
            headers: {
                accept: request.headers.accept,
                authorization: request.headers.authorization,
                contentType: request.headers["content-type"],
                cookie: request.headers.cookie,
                forwardedHost: request.headers["x-forwarded-host"],
                request: request.headers["x-request"],
                shared: request.headers["x-shared"],
                tenant: request.headers["x-tenant-id"],
                userAgent: request.headers["user-agent"],
            },
            method: request.method,
            url: request.url,
        });
        return;
    }

    if (url.pathname === "/retry") {
        retryCount += 1;
        if (retryCount < 3) {
            sendJson(response, { attempt: retryCount }, 503);
            return;
        }
        sendJson(response, { attempt: retryCount });
        return;
    }

    if (url.pathname === "/retry-after") {
        retryCount += 1;
        const body = JSON.stringify({ attempt: retryCount });

        response.writeHead(503, {
            "content-length": Buffer.byteLength(body),
            "content-type": "application/json",
            "retry-after": "60",
        });
        response.end(body);
        return;
    }

    if (url.pathname === "/error") {
        sendJson(response, { error: "Unavailable" }, 503);
        return;
    }

    if (url.pathname === "/slow") {
        setTimeout(() => sendJson(response, { ok: true }), 100);
        return;
    }

    if (url.pathname === "/download") {
        const body = "native-fetch-progress";
        response.writeHead(200, { "content-length": Buffer.byteLength(body) });
        response.write(body.slice(0, 8));
        response.end(body.slice(8));
        return;
    }

    if (url.pathname === "/download-unknown") {
        response.writeHead(200);
        response.write("unknown-");
        response.end("length");
        return;
    }

    if (url.pathname === "/empty") {
        response.writeHead(204);
        response.end();
        return;
    }

    sendJson(response, { error: "Not found" }, 404);
};

const server = createServer((request, response) => {
    void handle(request, response);
});

await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server failed to start");

baseUrl = `http://127.0.0.1:${String(address.port)}`;

after(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

beforeEach(() => {
    retryCount = 0;
});

describe("requests", () => {
    test("exports ready-to-use methods and configured instances", async () => {
        assert.equal(typeof ft.get, "function");
        assert.equal(typeof ft.create, "function");

        const api = ft.create({
            baseUrl: `${baseUrl}/api`,
            headers: { accept: "application/json", "x-shared": "instance" },
            prefix: "v1",
            searchParams: { locale: "en", page: 1 },
        });
        const result = await api
            .post("echo?keep=yes", {
                headers: { "x-request": "request", "x-shared": "request" },
                json: { name: "Gauts" },
                searchParams: { page: 2, tags: ["one", "two"] },
            })
            .json<Echo>();

        assert.equal(result.method, "POST");
        assert.equal(result.body, JSON.stringify({ name: "Gauts" }));
        assert.equal(result.headers.accept, "application/json");
        assert.equal(result.headers.contentType, "application/json");
        assert.equal(result.headers.request, "request");
        assert.equal(result.headers.shared, "request");
        assert.equal(
            result.url,
            "/api/v1/echo?keep=yes&locale=en&page=2&tags=one&tags=two",
        );
    });

    test("supports body and raw Response access", async () => {
        const response = await ft
            .post(`${baseUrl}/echo`, { body: "plain body" })
            .response();
        const result = (await response.json()) as Echo;

        assert.equal(result.body, "plain body");
        assert.equal(response.status, 200);
    });

    test("selects the server base URL automatically", async () => {
        const api = ft.create({
            baseUrl: {
                client: "http://127.0.0.1:1",
                server: baseUrl,
            },
        });
        const result = await api.get("echo").json<Echo>();

        assert.equal(result.url, "/echo");
    });

    test("supports relative browser base URLs", () => {
        const url = resolveUrl({
            baseUrl: "/proxy",
            input: "accounts",
            prefix: "v1",
            requestSearchParams: { page: 2 },
        });

        assert.equal(url, "/proxy/v1/accounts?page=2");
    });

    test("selects the client base URL without calling getHeaders", async () => {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {},
        });

        try {
            const api = ft.create({
                baseUrl: {
                    client: baseUrl,
                    server: "http://127.0.0.1:1",
                },
                forwardHeaders: true,
                getHeaders: () => {
                    throw new Error("Must not run in the browser");
                },
            });
            const result = await api.get("echo").json<Echo>();

            assert.equal(result.url, "/echo");
        } finally {
            Reflect.deleteProperty(globalThis, "window");
        }
    });

    test("forwards only allowlisted and explicitly configured headers", async () => {
        let calls = 0;
        const api = ft.create({
            baseUrl,
            forwardHeaders: {
                extra: ["x-tenant-id", "x-shared"],
            },
            getHeaders: () => {
                calls += 1;

                return {
                    authorization: "Bearer private",
                    cookie: "session=private",
                    "user-agent": "Incoming agent",
                    "x-forwarded-host": "dashboard.example.com",
                    "x-shared": "incoming",
                    "x-tenant-id": "tenant-123",
                };
            },
            headers: {
                "x-shared": "instance",
            },
        });
        const result = await api
            .get("echo", {
                headers: {
                    "x-shared": "request",
                },
                retry: 2,
            })
            .json<Echo>();

        assert.equal(calls, 1);
        assert.equal(result.headers.authorization, undefined);
        assert.equal(result.headers.cookie, undefined);
        assert.equal(result.headers.forwardedHost, "dashboard.example.com");
        assert.equal(result.headers.tenant, "tenant-123");
        assert.equal(result.headers.userAgent, "Incoming agent");
        assert.equal(result.headers.shared, "request");
    });

    test("requires a header provider only when forwarding on the server", async () => {
        const api = ft.create({ baseUrl, forwardHeaders: true });

        await assert.rejects(
            api.get("echo").response(),
            /getHeaders is required when forwardHeaders is enabled on the server/,
        );
    });

    test("rejects json and body used together", async () => {
        await assert.rejects(
            ft
                .post(`${baseUrl}/echo`, {
                    body: "body",
                    json: { value: true },
                })
                .response(),
            /json and body cannot be used together/,
        );
    });

    test("rejects JSON values that cannot be serialized", async () => {
        await assert.rejects(
            ft.post(`${baseUrl}/echo`, { json: Symbol("invalid") }).response(),
            /json must be serializable/,
        );
    });

    test("rejects search parameters used with a Request input", async () => {
        const request = new Request(`${baseUrl}/echo`);

        await assert.rejects(
            ft.get(request, { searchParams: { page: 2 } }).response(),
            /searchParams cannot be combined with a Request input/,
        );
    });

    test("keeps native empty JSON parsing behavior", async () => {
        await assert.rejects(ft.get(`${baseUrl}/empty`).json(), SyntaxError);
    });
});

describe("errors and reliability", () => {
    test("throws HTTPError with the final response", async () => {
        await assert.rejects(
            ft.get(`${baseUrl}/error`).json(),
            (error) => {
                assert.ok(error instanceof HTTPError);
                assert.equal(error.response.status, 503);
                assert.equal(error.request?.method, "GET");
                return true;
            },
        );
    });

    test("can return non-success responses", async () => {
        const response = await ft
            .get(`${baseUrl}/error`, { throwHttpErrors: false })
            .response();

        assert.equal(response.status, 503);
    });

    test("retries configured safe requests", async () => {
        const attempts: number[] = [];
        const result = await ft
            .get(`${baseUrl}/retry`, {
                onRetry: ({ attempt }) => attempts.push(attempt),
                retry: { baseDelay: 0, jitter: false, limit: 2 },
            })
            .json<{ attempt: number }>();

        assert.deepEqual(attempts, [1, 2]);
        assert.equal(result.attempt, 3);
    });

    test("retries when onRetry consumes the response body", async () => {
        const result = await ft
            .get(`${baseUrl}/retry`, {
                onRetry: async ({ response }) => {
                    await response?.text();
                },
                retry: { baseDelay: 0, jitter: false, limit: 2 },
            })
            .json<{ attempt: number }>();

        assert.equal(result.attempt, 3);
    });

    test("respects Retry-After without jitter or an early retry", () => {
        const retry = resolveRetry({ jitter: true, limit: 1, maxDelay: 30_000 });
        assert.ok(retry);

        const accepted = new Response(null, {
            headers: { "retry-after": "10" },
            status: 429,
        });
        const excessive = new Response(null, {
            headers: { "retry-after": "60" },
            status: 429,
        });

        assert.equal(
            getRetryDelay({ attempt: 1, config: retry, response: accepted }),
            10_000,
        );
        assert.equal(
            getRetryDelay({ attempt: 1, config: retry, response: excessive }),
            null,
        );
    });

    test("does not retry when Retry-After exceeds maxDelay", async () => {
        await assert.rejects(
            ft
                .get(`${baseUrl}/retry-after`, {
                    retry: { limit: 2, maxDelay: 30_000 },
                })
                .response(),
            HTTPError,
        );

        assert.equal(retryCount, 1);
    });

    test("does not retry POST by default", async () => {
        await assert.rejects(
            ft
                .post(`${baseUrl}/error`, {
                    retry: { baseDelay: 0, jitter: false, limit: 2 },
                })
                .response(),
            HTTPError,
        );

        assert.equal(retryCount, 0);
    });

    test("applies an overall timeout", async () => {
        await assert.rejects(
            ft.get(`${baseUrl}/slow`, { timeout: 20 }).response(),
            (error) => {
                assert.ok(error instanceof TimeoutError);
                assert.equal(error.timeout, 20);
                return true;
            },
        );
    });

    test("keeps the timeout active during retry delays", async () => {
        await assert.rejects(
            ft
                .get(`${baseUrl}/error`, {
                    retry: { baseDelay: 100, jitter: false, limit: 2 },
                    timeout: 20,
                })
                .response(),
            TimeoutError,
        );
    });

    test("cleans abort listeners after delays and invalid options", async () => {
        const delayController = new AbortController();
        await sleep(0, delayController.signal);
        assert.equal(getEventListeners(delayController.signal, "abort").length, 0);

        const optionController = new AbortController();
        await assert.rejects(
            ft
                .get(`${baseUrl}/echo`, {
                    signal: optionController.signal,
                    timeout: 0,
                })
                .response(),
            /timeout must be a positive number or false/,
        );
        await assert.rejects(
            ft
                .get(`${baseUrl}/echo`, {
                    retry: { limit: -1 },
                    signal: optionController.signal,
                })
                .response(),
            /retry.limit must be a non-negative number/,
        );
        assert.equal(getEventListeners(optionController.signal, "abort").length, 0);
    });
});

describe("callbacks", () => {
    test("runs callbacks in order and status actions only on the final response", async () => {
        const events: string[] = [];
        const runtimes: boolean[] = [];
        const api = ft.create({
            afterResponse: ({ attempt, isServer }) => {
                events.push(`after:${String(attempt)}`);
                runtimes.push(isServer);
            },
            beforeRequest: ({ attempt, isServer }) => {
                events.push(`before:${String(attempt)}`);
                runtimes.push(isServer);
            },
            onRetry: ({ attempt, isServer }) => {
                events.push(`retry:${String(attempt)}`);
                runtimes.push(isServer);
            },
            onStatus: {
                200: ({ attempt, isServer }) => {
                    events.push(`status:${String(attempt)}`);
                    runtimes.push(isServer);
                },
            },
            retry: { baseDelay: 0, jitter: false, limit: 2 },
        });

        await api.get(`${baseUrl}/retry`).json();

        assert.deepEqual(events, [
            "before:1",
            "after:1",
            "retry:1",
            "before:2",
            "after:2",
            "retry:2",
            "before:3",
            "after:3",
            "status:3",
        ]);
        assert.ok(runtimes.every(Boolean));
    });

    test("allows onError to replace the final error", async () => {
        let isServer = false;

        await assert.rejects(
            ft
                .get(`${baseUrl}/error`, {
                    onError: ({ error, isServer: current }) => {
                        isServer = current;
                        return new Error("Changed error", { cause: error });
                    },
                })
                .response(),
            /Changed error/,
        );

        assert.equal(isServer, true);
    });

    test("reports the browser runtime in callback contexts", async () => {
        const runtimes: boolean[] = [];

        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {},
        });

        try {
            await assert.rejects(
                ft
                    .get(`${baseUrl}/error`, {
                        afterResponse: ({ isServer }) => {
                            runtimes.push(isServer);
                        },
                        beforeRequest: ({ isServer }) => runtimes.push(isServer),
                        onError: ({ error, isServer }) => {
                            runtimes.push(isServer);
                            return error;
                        },
                        onStatus: {
                            503: ({ isServer }) => runtimes.push(isServer),
                        },
                    })
                    .response(),
                HTTPError,
            );
        } finally {
            Reflect.deleteProperty(globalThis, "window");
        }

        assert.deepEqual(runtimes, [false, false, false, false]);
    });

    test("propagates status action errors unchanged", async () => {
        const controlError = new Error("Control flow");

        await assert.rejects(
            ft
                .get(`${baseUrl}/error`, {
                    onError: () => new Error("Must not replace"),
                    onStatus: { 503: () => Promise.reject(controlError) },
                })
                .response(),
            (error) => error === controlError,
        );
    });
});

describe("progress", () => {
    test("reports download progress while preserving the response", async () => {
        const values: number[] = [];
        const response = await ft
            .get(`${baseUrl}/download`, {
                onDownloadProgress: ({ transferred }) => values.push(transferred),
            })
            .response();
        const body = await response.text();

        assert.equal(body, "native-fetch-progress");
        assert.equal(response.url, `${baseUrl}/download`);
        assert.equal(values.at(0), 0);
        assert.equal(values.at(-1), Buffer.byteLength(body));
    });

    test("reports upload progress through native request streams", async () => {
        const values: number[] = [];
        const result = await ft
            .post(`${baseUrl}/echo`, {
                body: "upload-body",
                onUploadProgress: ({ transferred }) => values.push(transferred),
            })
            .json<Echo>();

        assert.equal(result.body, "upload-body");
        assert.equal(values.at(0), 0);
        assert.equal(values.at(-1), Buffer.byteLength("upload-body"));
    });

    test("keeps unknown upload and download totals as null", async () => {
        const upload: { percent: number | null; total: number | null }[] = [];
        const form = new FormData();
        form.set("name", "Gauts");

        await ft
            .post(`${baseUrl}/echo`, {
                body: form,
                onUploadProgress: ({ percent, total }) => upload.push({ percent, total }),
            })
            .response();

        const download: { percent: number | null; total: number | null }[] = [];
        await ft
            .get(`${baseUrl}/download-unknown`, {
                onDownloadProgress: ({ percent, total }) => download.push({ percent, total }),
            })
            .text();

        assert.ok(upload.length > 0);
        assert.ok(download.length > 0);
        assert.ok(upload.every(({ percent, total }) => percent === null && total === null));
        assert.ok(download.every(({ percent, total }) => percent === null && total === null));
    });
});
