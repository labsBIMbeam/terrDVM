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
      nappletType: 'terrcvm-terrain',
      requires: ['resource'],
      title: 'terrCVM Terrain',
    }),
  ],
});
