import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/',
  plugins: [preact()],
  worker: { format: 'es' },
  test: {
    // globals: true lets @testing-library/preact register its automatic DOM cleanup between tests
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/engine/**/*.test.ts'],
    // Node 25+ prints an ExperimentalWarning when jsdom touches localStorage without a file
    poolOptions: { forks: { execArgv: ['--no-experimental-webstorage'] } },
    testTimeout: 60_000,
  },
});
