import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CACHE_DIR = resolve(import.meta.dirname, '../../.cache/map');

const NATURAL_EARTH_BASE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson';

interface Source {
  file: string;
  sha256: string;
}

export const NATURAL_EARTH = {
  land: {
    file: 'ne_50m_land.geojson',
    sha256: 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b',
  },
  rivers: {
    file: 'ne_50m_rivers_lake_centerlines.geojson',
    sha256: 'f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51',
  },
} as const satisfies Record<string, Source>;

export type LonLat = [lon: number, lat: number];
/** GeoJSON polygon in degrees: outer ring first, then holes. */
export type LonLatPolygon = LonLat[][];

export interface NaturalEarthRiver {
  name: string | null;
  featurecla: string;
  scalerank: number;
  lines: LonLat[][];
}

export interface NaturalEarth {
  land: LonLatPolygon[];
  rivers: NaturalEarthRiver[];
}

export async function loadNaturalEarth(): Promise<NaturalEarth> {
  const [land, rivers] = await Promise.all([
    readSource(NATURAL_EARTH.land),
    readSource(NATURAL_EARTH.rivers),
  ]);
  return { land: parseLand(land), rivers: parseRivers(rivers) };
}

async function readSource(source: Source): Promise<unknown> {
  const path = join(CACHE_DIR, source.file);
  if (!existsSync(path)) {
    const url = `${NATURAL_EARTH_BASE}/${source.file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    verify(source, body, url);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(`${path}.part`, body);
    renameSync(`${path}.part`, path);
  }
  const body = readFileSync(path);
  verify(source, body, path);
  return JSON.parse(body.toString('utf8'));
}

function verify(source: Source, body: Buffer, where: string): void {
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== source.sha256) {
    throw new Error(
      `${where} has sha256 ${actual}, expected ${source.sha256}. Delete it and rebuild to download it again.`,
    );
  }
}

function parseLand(raw: unknown): LonLatPolygon[] {
  return features(raw, NATURAL_EARTH.land.file).flatMap(({ geometry }, i) => {
    const where = `${NATURAL_EARTH.land.file} feature ${i}`;
    if (geometry.type === 'Polygon') return [polygon(geometry.coordinates, where)];
    if (geometry.type === 'MultiPolygon') {
      return array(geometry.coordinates, where).map((entry) => polygon(entry, where));
    }
    throw new Error(`${where}: unexpected geometry ${String(geometry.type)}`);
  });
}

function parseRivers(raw: unknown): NaturalEarthRiver[] {
  return features(raw, NATURAL_EARTH.rivers.file).map(({ geometry, properties }, i) => {
    const where = `${NATURAL_EARTH.rivers.file} feature ${i}`;
    const { name, featurecla, scalerank } = properties;
    if (typeof featurecla !== 'string' || typeof scalerank !== 'number') {
      throw new Error(`${where}: featurecla or scalerank missing`);
    }
    if (name !== null && typeof name !== 'string') throw new Error(`${where}: bad name`);
    let lines: unknown[];
    if (geometry.type === 'LineString') lines = [geometry.coordinates];
    else if (geometry.type === 'MultiLineString') lines = array(geometry.coordinates, where);
    else throw new Error(`${where}: unexpected geometry ${String(geometry.type)}`);
    return { name, featurecla, scalerank, lines: lines.map((entry) => positions(entry, where)) };
  });
}

interface Feature {
  geometry: { type: unknown; coordinates: unknown };
  properties: Record<string, unknown>;
}

function features(raw: unknown, where: string): Feature[] {
  const collection = raw as { type?: unknown; features?: unknown } | null;
  if (collection?.type !== 'FeatureCollection')
    throw new Error(`${where}: not a FeatureCollection`);
  return array(collection.features, where).map((entry, i) => {
    const feature = entry as { geometry?: unknown; properties?: unknown } | null;
    const geometry = feature?.geometry as Feature['geometry'] | null | undefined;
    const properties = feature?.properties;
    if (typeof geometry !== 'object' || geometry === null) {
      throw new Error(`${where} feature ${i}: no geometry`);
    }
    if (typeof properties !== 'object' || properties === null) {
      throw new Error(`${where} feature ${i}: no properties`);
    }
    return { geometry, properties: properties as Record<string, unknown> };
  });
}

function polygon(raw: unknown, where: string): LonLatPolygon {
  return array(raw, where).map((ring) => positions(ring, where));
}

function positions(raw: unknown, where: string): LonLat[] {
  return array(raw, where).map((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || typeof entry[1] !== 'number') {
      throw new Error(`${where}: bad position ${JSON.stringify(entry)}`);
    }
    return [entry[0], entry[1]];
  });
}

function array(raw: unknown, where: string): unknown[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected an array`);
  return raw;
}
