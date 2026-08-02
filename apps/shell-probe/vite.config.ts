import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    nip5aManifest({
      artifactMode: 'single-file',
      nappletType: 'terrcvm-shell-probe',
      // The R2 question verbatim: outbox and resource, and deliberately never
      // upload (VERTICAL-SLICE.md VS-4 manifest rule).
      requires: ['outbox', 'resource'],
      title: 'terrCVM shell probe',
    }),
  ],
});
