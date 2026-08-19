import type { HttpMethod } from "./types.js";

export const DEFAULTS = {
    retry: {
        baseDelay: 300,
        jitter: true,
        limit: 2,
        maxDelay: 30_000,
        methods: ["GET", "HEAD"] as readonly HttpMethod[],
        statusCodes: [408, 429, 500, 502, 503, 504] as readonly number[],
    },
    throwHttpErrors: true,
    timeout: false,
} as const;

export const FORWARD_HEADERS = [
    "accept-language",
    "cf-connecting-ip",
    "origin",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-user",
    "true-client-ip",
    "user-agent",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
] as const;
