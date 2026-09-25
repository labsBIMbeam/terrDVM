import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';
import { nappletMeta } from '../../scripts/vite-napplet-meta.mjs';

const napplet = {
  nappletType: 'terrcvm-field-measurement',
  // No capabilities at all: the instrument reading enters as a local
  // file and the record leaves as one. The corpus loop (fetch tiles by
  // hash) does not exist yet; when it does, the resource capability
  // gets declared alongside the code that uses it — not before.
  requires: [],
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
      title: 'terrCVM Field Measurement',
    }),
  ],
});
