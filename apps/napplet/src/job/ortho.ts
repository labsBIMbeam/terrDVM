import { loadApprovedBytes } from '../shell/resource-client';
import { COLLECTION_SERVICE } from './collection';
import type { BBox4326 } from '../bbox/validate';

/**
 * Orthophoto texture for terrain draping.
 *
 * The collection server bakes one image per requested extent — borders, not
 * tiles: regional imagery services answer an exact bbox in a single WMS
 * request, and the bake is a per-delivery artifact like GLB. The napplet stays
 * a reader: it asks the collection server for the bake and never talks to the
 * upstream imagery service itself.
 */
export const ORTHO_SERVICE = {
  /** Local collection server; a deployment points this at its own instance. */
  baseUrl: COLLECTION_SERVICE.baseUrl,
  // Generous: a cold Esri mosaic is a few hundred sequential upstream tile
  // fetches server-side. WMS-backed regions answer in one request.
  timeoutMs: 120_000,
  maxResponseBytes: 32 * 1024 * 1024,
  targetMPerPx: 0.25,
} as const;

export type OrthoSourceMeta = {
  id: string;
  name: string;
  license: string;
  attribution: string;
};

export type OrthoMeta = {
  mPerPx: number;
  widthPx: number;
  heightPx: number;
  source: OrthoSourceMeta;
  warnings: string[];
};

export type OrthoTexture = {
  bitmap: ImageBitmap;
  meta: OrthoMeta;
};

function bboxParam(bbox: BBox4326): string {
  return bbox.map((value) => value.toFixed(6)).join(',');
}

function textureUrl(path: '/texture' | '/texture/meta', region: string, bbox: BBox4326): string {
  const params = new URLSearchParams({
    region,
    bbox: bboxParam(bbox),
    target: String(ORTHO_SERVICE.targetMPerPx),
  });
  return `${ORTHO_SERVICE.baseUrl}${path}?${params.toString()}`;
}

export function orthoImageUrl(region: string, bbox: BBox4326): string {
  return textureUrl('/texture', region, bbox);
}

export function orthoMetaUrl(region: string, bbox: BBox4326): string {
  return textureUrl('/texture/meta', region, bbox);
}

export function isApprovedOrthoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.origin === new URL(ORTHO_SERVICE.baseUrl).origin &&
    (parsed.pathname === '/texture' ||
      parsed.pathname === '/texture/meta' ||
      parsed.pathname === '/texture/plan')
  );
}

/** Narrow the server's meta JSON, throwing a named error on any missing field. */
export function parseOrthoMeta(raw: unknown): OrthoMeta {
  const record = raw as Record<string, unknown> | null;
  const source = record?.source as Record<string, unknown> | undefined;
  const mPerPx = record?.m_per_px;
  const widthPx = record?.width_px;
  const heightPx = record?.height_px;

  if (
    typeof mPerPx !== 'number' ||
    typeof widthPx !== 'number' ||
    typeof heightPx !== 'number' ||
    typeof source?.id !== 'string' ||
    typeof source?.name !== 'string' ||
    typeof source?.license !== 'string' ||
    typeof source?.attribution !== 'string'
  ) {
    throw new Error('Orthophoto metadata is missing required provenance fields.');
  }

  return {
    mPerPx,
    widthPx,
    heightPx,
    source: {
      id: source.id,
      name: source.name,
      license: source.license,
      attribution: source.attribution,
    },
    warnings: Array.isArray(record?.warnings)
      ? (record.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
      : [],
  };
}

/**
 * Fetch the orthophoto bake for a selection.
 *
 * Metadata travels beside the image rather than in response headers because
 * the shell resource capability exposes bytes only. Both requests go through
 * `loadApprovedBytes`, so a denied capability fails closed here exactly as it
 * does for terrain.
 */
export async function fetchOrthoTexture(
  region: string,
  bbox: BBox4326,
  { signal }: { signal?: AbortSignal } = {},
): Promise<OrthoTexture> {
  const options = {
    deadlineMs: ORTHO_SERVICE.timeoutMs,
    isAllowed: isApprovedOrthoUrl,
    signal,
  };

  const metaBlob = await loadApprovedBytes(orthoMetaUrl(region, bbox), options);
  const meta = parseOrthoMeta(JSON.parse(await metaBlob.text()));

  const imageBlob = await loadApprovedBytes(orthoImageUrl(region, bbox), options);
  if (imageBlob.size > ORTHO_SERVICE.maxResponseBytes) {
    throw new Error('Orthophoto exceeded the approved response-size bound.');
  }

  const bitmap = await createImageBitmap(imageBlob);
  return { bitmap, meta };
}
