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
      //
      // The pure terrain, bbox, config and codec modules now live in
      // @terrcvm/terrain-engine and are measured by that package's own config.
      // What remains here is the shell-touching half: the collection client,
      // the OSM sources and the job flow.
      include: [
        'src/buildings/**',
        'src/features/**',
        'src/job/**',
        'src/ui/copy.ts',
        'src/ui/selection.ts',
        // The verification layer is pure and is the thing standing between a
        // hostile relay or blob server and the renderer; it belongs under the
        // gate, not beside it.
        'src/verify/**',
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
