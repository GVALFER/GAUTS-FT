import type { Progress } from "./types.js";

type TrackStreamInput = {
    onProgress: (progress: Progress) => void;
    stream: ReadableStream<Uint8Array>;
    total: number | null;
};

const getProgress = (transferred: number, total: number | null): Progress => ({
    percent: total === null ? null : total === 0 ? 1 : transferred / total,
    total,
    transferred,
});

export const getBodySize = (body: BodyInit | null | undefined): number | null => {
    if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
    if (body instanceof URLSearchParams) {
        return new TextEncoder().encode(body.toString()).byteLength;
    }
    if (body instanceof Blob) return body.size;
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;

    return null;
};

export const getContentLength = (headers: Headers): number | null => {
    const value = headers.get("content-length");

    if (value === null || value.trim() === "") return null;

    const length = Number(value);
    return Number.isFinite(length) && length >= 0 ? length : null;
};

export const trackStream = ({ onProgress, stream, total }: TrackStreamInput) => {
    let transferred = 0;

    onProgress(getProgress(0, total));

    return stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            flush: () => {
                if (transferred === 0) onProgress(getProgress(0, total));
            },
            transform: (chunk, controller) => {
                transferred += chunk.byteLength;
                onProgress(getProgress(transferred, total));
                controller.enqueue(chunk);
            },
        }),
    );
};

export const trackResponse = (response: Response, onProgress?: (progress: Progress) => void) => {
    if (!onProgress || !response.body) return response;

    const total = getContentLength(response.headers);
    const body = trackStream({ onProgress, stream: response.body, total });
    const tracked = new Response(body, response);

    Object.defineProperties(tracked, {
        redirected: { value: response.redirected },
        type: { value: response.type },
        url: { value: response.url },
    });

    return tracked;
};
