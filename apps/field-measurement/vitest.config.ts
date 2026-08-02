import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // The protocol layer is pure and is where a silent parsing or
      // classification mistake would launder a wrong number into a
      // `project-measured` provenance tag — it stays under the gate.
      include: ['src/protocol/**'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
