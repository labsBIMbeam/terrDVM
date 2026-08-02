import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // The shared logic moved to @terrcvm/napplet-kit and is measured by that
      // package's own config. What remains here is the unwired invoice
      // placeholder; the nostr modules and the intro need the browser-flavoured
      // globals and are exercised by their unit tests without being gated on
      // coverage, exactly as before the kit extraction.
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
