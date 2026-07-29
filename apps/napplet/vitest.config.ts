import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Only the pure logic is unit-testable here: rendering, the map view and
      // the shell adapter need a browser and are covered by the Paja smoke run.
      include: [
        'src/bbox/**',
        'src/buildings/**',
        'src/config/**',
        'src/features/**',
        'src/job/**',
        'src/terrain/dem.ts',
        'src/terrain/heightfield.ts',
        'src/terrain/mesh.ts',
        'src/ui/copy.ts',
        'src/ui/selection.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
