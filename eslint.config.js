import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist", "node_modules"],
    },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        files: ["src/**/*.ts", "tests/**/*.ts", "examples/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/consistent-type-definitions": ["error", "type"],
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-confusing-void-expression": "off",
            "@typescript-eslint/no-invalid-void-type": "off",
            "@typescript-eslint/no-magic-numbers": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-unnecessary-type-parameters": "off",
            "@typescript-eslint/prefer-readonly-parameter-types": "off",
        },
    },
    {
        files: ["tests/**/*.ts"],
        rules: {
            "@typescript-eslint/no-floating-promises": "off",
            "@typescript-eslint/no-unnecessary-condition": "off",
            "@typescript-eslint/require-await": "off",
        },
    },
);
