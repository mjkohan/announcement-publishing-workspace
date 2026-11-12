// src/mocks is excluded by the ESLint global ignores and by .prettierignore,
// so staged mock files are never rewritten.
/** @type {import("lint-staged").Configuration} */
export default {
  "*.{ts,tsx,js,mjs}": ["eslint --fix --no-warn-ignored", "prettier --write"],
  "*.{json,md,css,html,yml,yaml}": ["prettier --write"],
};
