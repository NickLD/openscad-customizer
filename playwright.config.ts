import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173/openscad-customizer/', acceptDownloads: true },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/openscad-customizer/', timeout: 180_000, reuseExistingServer: !process.env.CI },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
