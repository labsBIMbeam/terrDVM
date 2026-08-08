import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Only the pure logic is unit-testable here: the app shell and the
      // viewer wiring need a browser and are covered by the Paja smoke run.
      // The shared pipeline lives in @terrcvm/napplet-kit and is measured by
      // that package's own config.
      include: ['src/job/**'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
