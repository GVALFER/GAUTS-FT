import type { DownloadOptions } from "./types.js";

type DownloadInput = {
    options: DownloadOptions;
    response: Response;
};

type GetParamInput = {
    header: string;
    pattern: RegExp;
};

const DEFAULT_NAME = "download";
const encodedPattern = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i;
const filenamePattern = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i;

const cleanName = (value?: string) => {
    const name = value?.trim().split(/[\\/]/).at(-1)?.trim();
    if (!name) return undefined;

    return name;
};

const getParam = ({ header, pattern }: GetParamInput) => {
    const match = pattern.exec(header);

    return match?.[1] ?? match?.[2]?.trim();
};

const decodeName = (value?: string) => {
    const encoded = value?.match(/^UTF-8'[^']*'(.*)$/i)?.[1];
    if (!encoded) return undefined;

    try {
        return decodeURIComponent(encoded);
    } catch {
        return undefined;
    }
};

const getHeaderName = (response: Response) => {
    const header = response.headers.get("content-disposition");
    if (!header) return undefined;

    const encoded = getParam({ header, pattern: encodedPattern });
    const filename = getParam({ header, pattern: filenamePattern });

    return cleanName(decodeName(encoded)) ?? cleanName(filename);
};

export const getDownloadName = ({ options, response }: DownloadInput) => {
    return cleanName(options.filename) ?? getHeaderName(response) ?? DEFAULT_NAME;
};

export const saveDownload = async ({ options, response }: DownloadInput): Promise<void> => {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
        throw new TypeError("download() is only available in browser runtimes");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.download = getDownloadName({ options, response });
    anchor.hidden = true;
    anchor.href = url;

    try {
        document.body.appendChild(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
};
