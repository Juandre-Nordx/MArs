import { defineConfig } from '@playwright/test';
const externalWeb = process.env.MARS_TEST_WEB_URL;
const baseURL = externalWeb ?? 'http://127.0.0.1:5173';
if (externalWeb && new URL(externalWeb).origin !== externalWeb)
  throw new Error('MARS_TEST_WEB_URL must be a local origin');
if (
  externalWeb &&
  !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(externalWeb)
)
  throw new Error('MARS_TEST_WEB_URL must be a local origin');

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: externalWeb
    ? undefined
    : {
        command: 'npm run dev',
        env: process.env.MARS_TEST_DATABASE_URL
          ? { DATABASE_URL: process.env.MARS_TEST_DATABASE_URL }
          : undefined,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60000,
      },
});
