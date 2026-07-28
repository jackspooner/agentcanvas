import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  projects: [
    {
      name: 'fixture',
      testMatch: '**/agentcanvas-v2.spec.ts',
      use: { baseURL: 'http://127.0.0.1:23173' }
    },
    {
      name: 'macro-live',
      testMatch: '**/macros-proof.spec.ts',
      use: { baseURL: 'http://127.0.0.1:23174' }
    }
  ],
  webServer: [
    {
      command: 'npx vite --config fixture/vite.config.ts --host 127.0.0.1 --port 23173',
      url: 'http://127.0.0.1:23173/health',
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'npx tsx macro-live-server.ts',
      url: 'http://127.0.0.1:23174/health',
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
