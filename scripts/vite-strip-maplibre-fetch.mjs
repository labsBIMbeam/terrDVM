/**
 * Strip maplibre-gl's direct-network fallback from production artifacts.
 *
 * A conformant napplet may not contain direct browser network authority —
 * `napplet-conformance` (conformance-cli 0.2.16, src/scan.ts) statically
 * scans the built artifact for `fetch(` and friends and fails on any hit.
 * maplibre-gl 5.24.0 ships one `fetch(` call site in its prebuilt bundle:
 * the `makeFetchRequest` fallback that fires only for requests no registered
 * protocol claims. In this project every map request goes through the
 * `terrcvm://` custom protocol into the shell resource capability — the
 * style is an inline object, there is no glyph or sprite server, and tiles
 * are protocol-routed — so the fallback is unreachable dead code that still
 * reads as network authority to any honest scanner.
 *
 * This plugin replaces that single call site with a rejection carrying a
 * named reason, so the capability is genuinely absent from the artifact
 * rather than merely unexercised: any future code path that would have
 * reached the direct fetch now fails closed exactly like a network outage,
 * which maplibre already converts into a non-fatal AJAXError upstream.
 *
 * Build-only on purpose: `vite dev` serves maplibre through the dependency
 * optimizer where plugin transforms do not apply, so development keeps the
 * stock library. The count assertion makes a maplibre upgrade that moves or
 * multiplies the call site a loud build failure instead of a silent
 * capability regression; `scripts/verify-dist.mjs` re-checks the final HTML
 * from the outside.
 */

const MAPLIBRE_MODULE = /maplibre-gl[\\/]dist[\\/]maplibre-gl\.js$/;
const FETCH_CALL = /\b(?:window\s*\.\s*|globalThis\s*\.\s*)?fetch\s*\(/g;
const CALL_SITE = 'r=yield fetch(e);';
const REPLACEMENT =
  'r=yield Promise.reject(new Error(' +
  '"terrcvm: direct network fetch is stripped from this artifact; ' +
  'all I/O goes through the shell resource capability"));';

/** @returns {import('vite').Plugin} */
export function stripMaplibreFetch() {
  return {
    name: 'terrcvm-strip-maplibre-fetch',
    apply: 'build',
    transform(code, id) {
      if (!MAPLIBRE_MODULE.test(id)) return null;
      const sites = code.match(FETCH_CALL) ?? [];
      if (sites.length !== 1 || !code.includes(CALL_SITE)) {
        throw new Error(
          `terrcvm-strip-maplibre-fetch: expected exactly one known fetch call site in ${id}, ` +
            `found ${sites.length}. The maplibre-gl build changed — re-audit its network ` +
            'surface before shipping.',
        );
      }
      return { code: code.replace(CALL_SITE, REPLACEMENT), map: null };
    },
  };
}
