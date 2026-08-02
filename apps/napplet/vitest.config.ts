import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    // The measured logic moved to @terrcvm/napplet-kit (shared modules) and
    // apps/terrain (invoice); each destination carries the coverage gate that
    // used to live here. What remains in this package until the player app
    // lands are the nostr and intro modules and their tests.
  },
});
