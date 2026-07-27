import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    nip5aManifest({
      artifactMode: 'single-file',
      nappletType: 'terrdvm',
      requires: ['resource'],
      title: 'terrDVM',
    }),
  ],
});
