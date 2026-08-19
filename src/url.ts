import type { RequestInput, SearchParams, SearchValue } from "./types.js";

const absolutePattern = /^[a-z][a-z\d+.-]*:/i;
const placeholder = "http://ft.local";

const trimStart = (value: string) => value.replace(/^\/+/, "");
const trimEnd = (value: string) => value.replace(/\/+$/, "");

const joinPath = (...values: (string | undefined)[]) =>
    values
        .filter((value): value is string => Boolean(value))
        .map((value, index) => (index === 0 ? trimEnd(value) : trimStart(trimEnd(value))))
        .filter(Boolean)
        .join("/");

const addValue = (params: URLSearchParams, key: string, value: SearchValue) => {
    if (value !== null && value !== undefined) {
        params.append(key, String(value));
    }
};

const setSearchParams = (target: URLSearchParams, values?: SearchParams) => {
    if (!values) return;

    if (values instanceof URLSearchParams) {
        const entries = Array.from(values.entries());
        const keys = new Set(entries.map(([key]) => key));

        for (const key of keys) target.delete(key);
        for (const [key, value] of entries) addValue(target, key, value);
        return;
    }

    if (Array.isArray(values)) {
        const entries = values as readonly (readonly [string, SearchValue])[];
        const keys = new Set(entries.map(([key]) => key));

        for (const key of keys) target.delete(key);
        for (const [key, value] of entries) addValue(target, key, value);
        return;
    }

    for (const [key, value] of Object.entries(values)) {
        target.delete(key);

        if (Array.isArray(value)) {
            for (const item of value as readonly SearchValue[]) addValue(target, key, item);
        } else {
            addValue(target, key, value as SearchValue);
        }
    }
};

type ResolveUrlInput = {
    baseUrl?: string | URL | undefined;
    input: Exclude<RequestInput, Request>;
    prefix?: string | undefined;
    searchParams?: SearchParams | undefined;
    requestSearchParams?: SearchParams | undefined;
};

export const resolveUrl = ({
    baseUrl,
    input,
    prefix,
    requestSearchParams,
    searchParams,
}: ResolveUrlInput): string => {
    const inputValue = input.toString();
    const isAbsolute = absolutePattern.test(inputValue);
    const baseValue = baseUrl?.toString();
    const isBaseAbsolute = Boolean(baseValue && absolutePattern.test(baseValue));
    let value: string;

    if (isAbsolute) {
        value = inputValue;
    } else if (baseValue && isBaseAbsolute) {
        const base = `${trimEnd(baseValue)}/`;
        value = new URL(joinPath(prefix, inputValue), base).toString();
    } else {
        value = joinPath(baseValue, prefix, inputValue);
    }

    const url = new URL(value || "", isAbsolute || isBaseAbsolute ? undefined : placeholder);

    setSearchParams(url.searchParams, searchParams);
    setSearchParams(url.searchParams, requestSearchParams);

    if (isAbsolute || isBaseAbsolute) return url.toString();

    return `${url.pathname}${url.search}${url.hash}`;
};
