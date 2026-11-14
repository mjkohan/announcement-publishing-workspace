import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
/** Firefox is opt-in locally (`PW_FIREFOX=1`, after `npx playwright install firefox`). */
const withFirefox = !isCI && process.env.PW_FIREFOX === "1";

export default defineConfig({
  testDir: "e2e",
  // Each test gets its own browser context, so a fresh sessionStorage (journal and mock).
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI && { workers: 1 }),
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  // Publications take up to ~10 s in the "overlapping" scenario.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(withFirefox ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }] : []),
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
