import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/openscad-customizer/',
  plugins: [preact()],
  worker: { format: 'es' },
  test: {
    // globals: true lets @testing-library/preact register its automatic DOM cleanup between tests
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/engine/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
