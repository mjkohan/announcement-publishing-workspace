import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app from /<repo>/. The deploy job sets BASE_PATH;
  // local dev, preview and e2e use the root.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    // Playwright specs run with `npm run test:e2e`, not Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
