import ft from "@gauts/ft";

type Account = {
    email: string;
    id: string;
};

const account = await ft
    .get("https://api.example.com/accounts/123")
    .json<Account>();

console.log(account);
