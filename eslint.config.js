import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "coverage", "playwright-report", "test-results", "src/mocks/**"]),

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Application and TypeScript tooling code: full type-aware linting.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  // Plain JavaScript config files and Node scripts: Node globals, no type-checked rules.
  {
    files: ["*.config.js", "scripts/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // CLI scripts report results on stdout.
    files: ["scripts/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },

  prettier,
]);
