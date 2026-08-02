import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Unlike the app and the engine, this package has no rendering, no
      // transport and no browser surface — it is pure functions over numbers
      // and strings. Nothing here is untestable, so the bar is higher.
      include: ['src/**'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
