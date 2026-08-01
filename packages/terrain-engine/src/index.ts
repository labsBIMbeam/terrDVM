/**
 * Convenience barrel for the pure engine.
 *
 * Deliberately excludes `render/preview3d` (WebGL2) and `map/*` (MapLibre):
 * importing those from a node test would drag a browser-only dependency in for
 * no reason. Reach for them by subpath — `@terrcvm/terrain-engine/render/preview3d`.
 */
export * from './bbox/validate';
export * from './bbox/area';
export * from './bbox/request-preview';
export * from './config/defaults';
export * from './config/regions';
export * from './config/coverage';
export * from './terrain/dem';
export * from './terrain/heightfield';
export * from './terrain/mesh';
export * from './features/types';
export * from './features/codec';
export * from './features/landcover';
export * from './features/ribbon';
export * from './buildings/extrude';
export * from './viewer/glb';
