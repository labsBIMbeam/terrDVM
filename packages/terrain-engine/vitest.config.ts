import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      // Same rule the app carried: only pure logic is unit-testable here.
      // Rendering (`render/`) and the map view need a browser and stay covered
      // by the Paja smoke run in apps/napplet.
      include: [
        'src/bbox/**',
        'src/buildings/**',
        'src/config/**',
        'src/features/**',
        'src/terrain/dem.ts',
        'src/terrain/heightfield.ts',
        'src/terrain/mesh.ts',
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
