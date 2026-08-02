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
      nappletType: 'terrcvm-field-measurement',
      // No capabilities at all: the instrument reading enters as a local
      // file and the record leaves as one. The corpus loop (fetch tiles by
      // hash) does not exist yet; when it does, the resource capability
      // gets declared alongside the code that uses it — not before.
      requires: [],
      title: 'terrCVM Field Measurement',
    }),
  ],
});
