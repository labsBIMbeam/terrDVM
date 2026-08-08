import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';
import { stripMaplibreFetch } from '../../scripts/vite-strip-maplibre-fetch.mjs';

export default defineConfig({
  build: {
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    stripMaplibreFetch(),
    nip5aManifest({
      artifactMode: 'single-file',
      nappletType: 'terrcvm-player',
      // Only the shell resource capability. The player does not declare a
      // publish capability because its production artifact cannot publish:
      // the NIP-07/relay path is development-only (src/nostr/transport.ts)
      // and the shell OUTBOX domain is not wired yet.
      requires: ['resource'],
      title: 'terrCVM Player',
    }),
  ],
});
