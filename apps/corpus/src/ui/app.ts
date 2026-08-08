/**
 * The corpus reader's face: discover, verify, render — or say exactly what is
 * missing.
 *
 * The no-data state is not an error path. It is a RESULT, rendered with the
 * same care as a successful tile, because "this tile has no features" is a
 * true and useful answer about the world and the one thing this project
 * refuses to fake.
 */

import { createTerrainViewer, type TerrainViewer } from '@terrcvm/terrain-engine/render/preview3d';
import { tileBBox, type Tile } from '@terrcvm/geo-protocol';
import { discoverTile, loadItemBytes, type TileDiscovery } from '../corpus/load';
import { createCorpusTransport } from '../corpus/transport';
import {
  buildCorpusFeatures,
  buildCorpusTerrain,
  corpusGround,
  decodeCorpusFeatures,
  decodeDemRaster,
} from '../corpus/scene';
import type { CorpusCollection } from '../corpus/select';
import type { CorpusConfig } from '../config';

const DEM_DATASET = 'dem';
const FEATURES_DATASET = 'features';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tileLabel(tile: Tile): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** Credit travels the protocol: every collection that answered is named. */
function attributionLine(collections: readonly CorpusCollection[]): string {
  if (collections.length === 0) return 'No collection announced an attribution.';
  return collections
    .map((collection) => `${collection.title} — ${collection.source} (${collection.license})`)
    .join(' · ');
}

export function renderApp(root: HTMLElement, config: CorpusConfig): void {
  root.replaceChildren();
  const shell = element('div', 'corpus');

  const header = element('header', 'corpus-header');
  header.append(element('h1', 'corpus-title', 'terrCVM Corpus'));
  const subtitle = element(
    'p',
    'corpus-subtitle',
    `tile ${tileLabel(config.tile)} · relay ${config.relay}`,
  );
  header.append(subtitle);
  shell.append(header);

  const status = element('p', 'corpus-status', 'Starting…');
  status.setAttribute('role', 'status');
  shell.append(status);

  const canvas = element('canvas', 'corpus-canvas');
  canvas.width = 960;
  canvas.height = 600;
  shell.append(canvas);

  const report = element('div', 'corpus-report');
  shell.append(report);

  const attribution = element('p', 'corpus-attribution');
  shell.append(attribution);

  root.append(shell);

  let viewer: TerrainViewer | null = null;

  const say = (text: string): void => {
    status.textContent = text;
  };

  const showCoverage = (found: TileDiscovery): void => {
    report.replaceChildren();
    const list = element('ul', 'corpus-coverage');
    for (const entry of found.coverage) {
      const answer = entry.covered
        ? `covered by ${tileLabel(entry.tile!)}`
        : 'no item covers this tile';
      list.append(element('li', entry.covered ? 'is-covered' : 'is-missing',
        `${entry.dataset}: ${answer}`));
    }
    report.append(list);
    if (found.rejected > 0) {
      report.append(
        element(
          'p',
          'corpus-rejected',
          `${found.rejected} event(s) rejected: wrong author, or the signature did not verify.`,
        ),
      );
    }
  };

  const run = async (): Promise<void> => {
    if (config.publisher === null) {
      say(
        'No publisher key configured. This client trusts exactly one publisher and will not ' +
          'guess which — pass ?publisher=<64 hex> to name it.',
      );
      return;
    }

    let servers: string[] = [];
    const transport = createCorpusTransport({
      relay: config.relay,
      servers: () => servers,
    });

    say(`Asking ${config.relay} what covers ${tileLabel(config.tile)}…`);
    const found = await discoverTile(transport, {
      publisher: config.publisher,
      tile: config.tile,
    });
    servers = [...new Set(found.collections.map((collection) => collection.server))];
    attribution.textContent = attributionLine(found.collections);
    showCoverage(found);

    const demItem = found.selected.get(DEM_DATASET);
    const featureItem = found.selected.get(FEATURES_DATASET);

    if (demItem === undefined) {
      // Without elevation there is no surface to stand anything on. Saying so
      // is the answer; drawing a flat plate would be a fabricated one.
      say(
        `No elevation covers ${tileLabel(config.tile)} in this corpus. Nothing is rendered, ` +
          'and nothing was fetched from anywhere else.',
      );
      return;
    }

    const serverFor = (dataset: string): string => {
      const collection = found.collections.find((entry) => entry.dataset === dataset);
      return collection?.server ?? servers[0] ?? '';
    };

    const bbox = tileBBox(config.tile);

    say(`Fetching elevation ${demItem.sha256.slice(0, 12)}… by hash`);
    const demBytes = await loadItemBytes(transport, demItem, serverFor(DEM_DATASET));
    const raster = await decodeDemRaster(demBytes, demItem.tile);
    const mesh = buildCorpusTerrain(raster, bbox);
    const ground = corpusGround(mesh);

    let built: ReturnType<typeof buildCorpusFeatures> | null = null;
    if (featureItem !== undefined) {
      say(`Fetching features ${featureItem.sha256.slice(0, 12)}… by hash`);
      const featureBytes = await loadItemBytes(transport, featureItem, serverFor(FEATURES_DATASET));
      built = buildCorpusFeatures(decodeCorpusFeatures(featureBytes), bbox, ground);
    }

    viewer?.destroy();
    viewer = createTerrainViewer(canvas, mesh, {
      autoRotate: true,
      ...(built?.buildings ? { buildings: built.buildings } : {}),
      ...(built?.roads ? { roads: built.roads } : {}),
      ...(built?.landcover ? { landcover: built.landcover } : {}),
    });

    const relief = `${Math.round(mesh.stats.minElevationM)}–${Math.round(mesh.stats.maxElevationM)} m`;
    if (built === null) {
      // The honest half-answer: ground yes, features no. Two different facts,
      // reported as two different facts.
      say(
        `Rendered elevation only for ${tileLabel(config.tile)} (${relief}), from ` +
          `${tileLabel(demItem.tile)}. No features are published for this tile.`,
      );
    } else {
      say(
        `Rendered ${tileLabel(config.tile)} from the corpus: ${relief}, ` +
          `${built.counts.buildings} buildings, ${built.counts.roads} roads, ` +
          `${built.counts.landuse} land-use areas. Bytes came from the relay and the ` +
          'blossom host only.',
      );
    }
  };

  void run().catch((error: unknown) => {
    say(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
  });
}
