/**
 * Stamp the napplet's identity and its shell needs into the built HTML.
 *
 * `@napplet/vite-plugin` 0.14 keeps protocol metadata out of `index.html`:
 * `nappletType` and `requires` land only in the kind 35129 manifest sidecar
 * (`dist/.nip5a-manifest.json`). The shared napplet baseline also wants both
 * on the artifact itself — `<meta name="napplet-type">` and
 * `<meta name="napplet-requires">` — so a host that is handed the single HTML
 * file (the Nappelin Hangar's `check:napplets`, for one) can read what the
 * napplet needs from the shell without the manifest.
 *
 * Each app passes the SAME object to this plugin and to `nip5aManifest`, so
 * the meta and the manifest cannot drift apart; `scripts/verify-dist.mjs`
 * re-checks both from the outside after every build.
 *
 * @param {{ nappletType: string; requires: string[] }} napplet
 * @returns {import('vite').Plugin}
 */
export function nappletMeta({ nappletType, requires }) {
  if (typeof nappletType !== 'string' || nappletType === '') {
    throw new Error('terrcvm-napplet-meta: nappletType must be a non-empty string');
  }
  if (!Array.isArray(requires) || requires.some((domain) => !/^[a-z][a-z0-9.-]*$/.test(domain))) {
    throw new Error('terrcvm-napplet-meta: requires must be a list of bare domain names');
  }

  return {
    name: 'terrcvm-napplet-meta',
    // `pre` runs on the source index.html, so the two metas sit next to the
    // title instead of after the inlined bundle.
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { name: 'napplet-type', content: nappletType },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { name: 'napplet-requires', content: requires.join(',') },
          injectTo: 'head',
        },
      ],
    },
  };
}
