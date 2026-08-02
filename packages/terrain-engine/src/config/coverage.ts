import europe from './coverage/europe.json';
import madeira from './coverage/madeira.json';
import southTyrol from './coverage/south-tyrol.json';

/**
 * Imagery-coverage surveys, one per region.
 *
 * Stored as .json rather than .geojson because Vite has built-in JSON
 * handling; an unknown extension is served as an asset URL, not a module.
 *
 * Baked in rather than fetched: these are produced by the server's `coverage`
 * command and change on the cadence of aerial survey programmes — years, not
 * minutes. Shipping them removes a network dependency from the one screen whose
 * job is to tell the user what is *not* available.
 */
const SURVEYS: Record<string, unknown> = {
  europe,
  madeira,
  'south-tyrol': southTyrol,
};

export function coverageFor(regionId: string): GeoJSON.FeatureCollection | null {
  const survey = SURVEYS[regionId];
  return (survey as GeoJSON.FeatureCollection) ?? null;
}
