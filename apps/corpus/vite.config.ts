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
      nappletType: 'terrcvm-corpus',
      // The two capabilities the corpus path needs and nothing else. `outbox`
      // reads the announcements, `resource` fetches blobs by hash. `upload` is
      // deliberately absent: this napplet is a reader of a corpus it can never
      // write to, and the manifest is where that is enforced rather than
      // promised (VERTICAL-SLICE.md VS-4).
      requires: ['outbox', 'resource'],
      title: 'terrCVM Corpus',
    }),
  ],
});
