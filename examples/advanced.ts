import ft, { HTTPError } from "@gauts/ft";

type Account = {
    email: string;
    id: string;
};

const api = ft.create({
    baseUrl: "https://api.example.com",
    headers: {
        accept: "application/json",
    },
    onError: ({ error }) => {
        if (error instanceof HTTPError) {
            console.error(error.response.status);
        }

        return error;
    },
    onStatus: {
        503: () => {
            throw new Error("The service is temporarily unavailable");
        },
    },
    prefix: "v1",
    retry: 2,
    timeout: 10_000,
});

const account = await api
    .post("accounts", {
        json: {
            email: "user@example.com",
        },
        onDownloadProgress: ({ percent }) => {
            console.log(percent);
        },
    })
    .json<Account>();

console.log(account);
