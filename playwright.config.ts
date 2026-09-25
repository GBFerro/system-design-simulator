import { defineConfig, devices } from "@playwright/test";

// Non-default port so E2E runs don't collide with a dev server on :3000
const port = Number(process.env.E2E_PORT ?? 3100);
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI builds first, so serve the production build there; locally use dev
    command: isCI ? `npx next start -p ${port}` : `npx next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
