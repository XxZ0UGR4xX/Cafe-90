import { defineConfig } from '@playwright/test';

/** E2E contra la app real (API en :3000 con seed demo y web en :5173). Ver docs/TESTING.md. */
export default defineConfig({
  testDir: './tests', timeout: 90_000, fullyParallel: false, workers: 1, retries: 0, reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', viewport: { width: 1366, height: 820 }, screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } },
});
