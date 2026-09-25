import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';
import { stripMaplibreFetch } from '../../scripts/vite-strip-maplibre-fetch.mjs';
import { nappletMeta } from '../../scripts/vite-napplet-meta.mjs';

const napplet = {
  nappletType: 'terrcvm-terrain',
  requires: ['resource'],
};

export default defineConfig({
  build: {
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    stripMaplibreFetch(),
    nappletMeta(napplet),
    nip5aManifest({
      artifactMode: 'single-file',
      ...napplet,
      title: 'terrCVM Terrain',
    }),
  ],
});
