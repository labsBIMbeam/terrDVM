import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';
import { nappletMeta } from '../../scripts/vite-napplet-meta.mjs';

const napplet = {
  nappletType: 'terrcvm-shell-probe',
  // The R2 question verbatim: outbox and resource, and deliberately never
  // upload (VERTICAL-SLICE.md VS-4 manifest rule).
  requires: ['outbox', 'resource'],
};

export default defineConfig({
  build: {
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    nappletMeta(napplet),
    nip5aManifest({
      artifactMode: 'single-file',
      ...napplet,
      title: 'terrCVM shell probe',
    }),
  ],
});
