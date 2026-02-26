import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  { ignores: ["node_modules", "dist", "build", "**/*.cjs"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "unused-imports": unusedImports,
    },
    rules: {
      "unused-imports/no-unused-imports": "error",
    },
  },
];
