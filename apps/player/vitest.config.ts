import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    watch: false,
    // The nostr and intro modules are exercised by their unit tests without a
    // coverage gate, exactly as they were in the monolith: the app shell, the
    // globe and the sound layer need a browser and are outside unit scope.
  },
});
