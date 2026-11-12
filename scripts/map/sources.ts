import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { intersection } from './geometry.ts';
import { EXTENT_BOX } from './projection.ts';
import { readCandidates, type SettlementCandidate } from './settlements.ts';

const CACHE_DIR = resolve(import.meta.dirname, '../../.cache/map');
const DOWNLOADS_AT_ONCE = 8;
const DOWNLOAD_ATTEMPTS = 3;

const NATURAL_EARTH =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson';
const ETOPO10 =
  'https://raw.githubusercontent.com/g2e/etopo10/983b031cd3e01ff0dd1a7933a4213efc718da662';
const RESOLVE =
  'https://raw.githubusercontent.com/CatalogueOfLife/col-gazetteers/d96828acebaa8576fd5f9c1b06bc44dd2955adbe/teow';
const PLEIADES =
  'https://raw.githubusercontent.com/isawnyu/pleiades.datasets/ff9639804f66e521b63d2208a00b60602ec787cf/data/gis';

interface Source {
  url: string;
  sha256: string;
}

export const SOURCES = {
  land: {
    url: `${NATURAL_EARTH}/ne_50m_land.geojson`,
    sha256: 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b',
  },
  rivers: {
    url: `${NATURAL_EARTH}/ne_50m_rivers_lake_centerlines.geojson`,
    sha256: 'f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51',
  },
  regions: {
    url: `${NATURAL_EARTH}/ne_10m_geography_regions_polys.geojson`,
    sha256: 'b7b26e50ea917d3696aec87f932def2bf5f890f5770e441d59c162c6f4c92a77',
  },
  elevationPoints: {
    url: `${NATURAL_EARTH}/ne_10m_geography_regions_elevation_points.geojson`,
    sha256: 'f98a16867867146ec4146d6d4b18c823eeedb2825947de666116cf9a4e3f43cb',
  },
  lakes: {
    url: `${NATURAL_EARTH}/ne_10m_lakes.geojson`,
    sha256: '2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9',
  },
  elevation: {
    url: `${ETOPO10}/etopo10_ice_g_i2.bin`,
    sha256: '9b761686567304a29a1a8a363c0b62ba2e2a0f9e49fa75c282a0dd604e1af24e',
  },
  ecoregionOverview: {
    url: `${RESOLVE}/overview.geojson`,
    sha256: '18ac228fdf791d09af5f3f285dba5225dda036b1a8f190bbdb9052c5a7bec4a1',
  },
  places: {
    url: `${PLEIADES}/places.csv`,
    sha256: '0f46ac89a3def8314e1a8d283c7e357bfd0f7c2cd8346842dd01755e3e476fd4',
  },
  locationPoints: {
    url: `${PLEIADES}/location_points.csv`,
    sha256: '0f46b107f1037c68e637e7bd81451126986a989d5d12da1dfe7c84c9cdb8b003',
  },
  placeTypes: {
    url: `${PLEIADES}/places_place_types.csv`,
    sha256: 'd63735e7e23ed76275704167e7df39c06c9c4ba34a6252a6b4543d23e930e172',
  },
  connections: {
    url: `${PLEIADES}/connections.csv`,
    sha256: '2951f97c693b308d37724c15170a3edfee6a021e7e865ff72b0dac25d770c394',
  },
  timePeriods: {
    url: `${PLEIADES}/time_periods.csv`,
    sha256: 'd1395f5f020f02de1deca003258c195227d69eb295e55044bc20bc82219da119',
  },
} as const satisfies Record<string, Source>;

/** Over the selected ecoregion files' bytes, concatenated in ascending id order. */
const ECOREGION_FEATURES_SHA256 =
  '5fb17c09caf1327ad9222813c840bf01328f90bba5ef192c785e9a5963dc408c';
const ECOREGION_MARGIN_DEG = 1;

/** ETOPO10: int16 metres, little-endian, row 0 at 90°N, column 0 at 180°W, gridline registered. */
export const ELEVATION_GRID = { columns: 2161, rows: 1081, perDegree: 6 } as const;

export type LonLat = [lon: number, lat: number];
/** GeoJSON polygon in degrees: outer ring first, then holes. */
export type LonLatPolygon = LonLat[][];

export interface NaturalEarthRiver {
  name: string | null;
  featurecla: string;
  scalerank: number;
  lines: LonLat[][];
}

export interface NaturalEarthRegion {
  featurecla: string;
  name: string;
  nameEn: string | null;
  polygons: LonLatPolygon[];
}

export interface NaturalEarthPoint {
  featurecla: string;
  name: string | null;
  elevation: number;
  at: LonLat;
}

export interface NaturalEarthLake {
  featurecla: string;
  name: string | null;
  polygons: LonLatPolygon[];
}

export interface Ecoregion {
  name: string;
  biome: number;
  polygons: LonLatPolygon[];
}

/** Row-major heights in metres, `ELEVATION_GRID.columns` per row. */
export type ElevationGrid = Int16Array;

export interface Sources {
  land: LonLatPolygon[];
  rivers: NaturalEarthRiver[];
  regions: NaturalEarthRegion[];
  elevationPoints: NaturalEarthPoint[];
  lakes: NaturalEarthLake[];
  elevation: ElevationGrid;
  ecoregions: Ecoregion[];
  settlementCandidates: SettlementCandidate[];
}

export async function loadSources(): Promise<Sources> {
  const [
    land,
    rivers,
    regions,
    elevationPoints,
    lakes,
    elevation,
    ecoregions,
    settlementCandidates,
  ] = await Promise.all([
    readJson(SOURCES.land).then(parseLand),
    readJson(SOURCES.rivers).then(parseRivers),
    readJson(SOURCES.regions).then(parseRegions),
    readJson(SOURCES.elevationPoints).then(parseElevationPoints),
    readJson(SOURCES.lakes).then(parseLakes),
    readSource(SOURCES.elevation).then(parseElevation),
    readJson(SOURCES.ecoregionOverview).then(readEcoregions),
    readPleiades(),
  ]);
  return {
    land,
    rivers,
    regions,
    elevationPoints,
    lakes,
    elevation,
    ecoregions,
    settlementCandidates,
  };
}

async function readPleiades(): Promise<SettlementCandidate[]> {
  const [places, locationPoints, placeTypes, connections, timePeriods] = await Promise.all([
    readText(SOURCES.places),
    readText(SOURCES.locationPoints),
    readText(SOURCES.placeTypes),
    readText(SOURCES.connections),
    readText(SOURCES.timePeriods),
  ]);
  return readCandidates({ places, locationPoints, placeTypes, connections, timePeriods });
}

async function readJson(source: Source): Promise<unknown> {
  return JSON.parse(await readText(source));
}

async function readText(source: Source): Promise<string> {
  return (await readSource(source)).toString('utf8');
}

async function readSource({ url, sha256 }: Source): Promise<Buffer> {
  const [body] = await readSources([url], sha256, url);
  return body as Buffer;
}

/**
 * Reads `urls` through the cache. One sha256 covers their bytes concatenated in order; it is
 * checked on download, before anything is cached, and on every read.
 */
async function readSources(urls: string[], sha256: string, what: string): Promise<Buffer[]> {
  const paths = urls.map((url) => join(CACHE_DIR, new URL(url).pathname));
  const missing = paths.flatMap((path, i) => (existsSync(path) ? [] : [i]));
  const downloaded = new Map<number, Buffer>();
  let next = 0;
  await Promise.all(
    Array.from({ length: DOWNLOADS_AT_ONCE }, async () => {
      for (let i = missing[next++]; i !== undefined; i = missing[next++]) {
        downloaded.set(i, await download(urls[i] as string));
      }
    }),
  );
  const bodies = paths.map((path, i) => downloaded.get(i) ?? readFileSync(path));
  const files = urls.length > 1 ? ` (${urls.length} files)` : '';
  if (missing.length > 0) verify(bodies, sha256, `${what}${files}`, '');
  else {
    const cached = relative(
      process.cwd(),
      urls.length > 1 ? dirname(paths[0] ?? '') : (paths[0] ?? ''),
    );
    verify(
      bodies,
      sha256,
      `${cached}${files}`,
      ' Delete the cached copy and rebuild to download it again.',
    );
  }
  for (const [i, body] of downloaded) {
    const path = paths[i] as string;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, body);
    renameSync(`${path}.part`, path);
  }
  return bodies;
}

async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === DOWNLOAD_ATTEMPTS) throw error;
    }
  }
}

function verify(bodies: Buffer[], expected: string, where: string, hint: string): void {
  const hash = createHash('sha256');
  for (const body of bodies) hash.update(body);
  const actual = hash.digest('hex');
  if (actual !== expected)
    throw new Error(`${where} has sha256 ${actual}, expected ${expected}.${hint}`);
}

/** The ecoregions whose outline touches the extent's box grown by `ECOREGION_MARGIN_DEG`. */
async function readEcoregions(overview: unknown): Promise<Ecoregion[]> {
  const where = SOURCES.ecoregionOverview.url;
  const { west, east, south, north } = EXTENT_BOX;
  const m = ECOREGION_MARGIN_DEG;
  const box: LonLat[] = [
    [west - m, south - m],
    [east + m, south - m],
    [east + m, north + m],
    [west - m, north + m],
  ];
  const ids = features(overview, where)
    .flatMap(({ geometry, properties }, i) => {
      const id = Number(properties.id);
      if (!Number.isInteger(id)) throw new Error(`${where} feature ${i}: bad id`);
      return intersection(areas(geometry, `${where} feature ${i}`), [[box]]).length > 0 ? [id] : [];
    })
    .sort((a, b) => a - b);
  const urls = ids.map((id) => `${RESOLVE}/features/${id}.geojson`);
  const bodies = await readSources(urls, ECOREGION_FEATURES_SHA256, `${RESOLVE}/features`);
  return bodies.map((body, i) => parseEcoregion(JSON.parse(body.toString('utf8')), urls[i] ?? ''));
}

function parseEcoregion(raw: unknown, where: string): Ecoregion {
  const { geometry, properties } = feature(raw, where);
  const biome = properties.BIOME_NUM;
  if (typeof biome !== 'number') throw new Error(`${where}: BIOME_NUM missing`);
  return { name: text(properties, 'ECO_NAME', where), biome, polygons: areas(geometry, where) };
}

function parseLand(raw: unknown): LonLatPolygon[] {
  const where = SOURCES.land.url;
  return features(raw, where).flatMap(({ geometry }, i) =>
    areas(geometry, `${where} feature ${i}`),
  );
}

function parseRivers(raw: unknown): NaturalEarthRiver[] {
  return features(raw, SOURCES.rivers.url).map(({ geometry, properties }, i) => {
    const where = `${SOURCES.rivers.url} feature ${i}`;
    const { scalerank } = properties;
    if (typeof scalerank !== 'number') throw new Error(`${where}: scalerank missing`);
    let lines: unknown[];
    if (geometry.type === 'LineString') lines = [geometry.coordinates];
    else if (geometry.type === 'MultiLineString') lines = array(geometry.coordinates, where);
    else throw new Error(`${where}: unexpected geometry ${String(geometry.type)}`);
    return {
      name: optionalText(properties, 'name', where),
      featurecla: text(properties, 'featurecla', where),
      scalerank,
      lines: lines.map((entry) => positions(entry, where)),
    };
  });
}

function parseRegions(raw: unknown): NaturalEarthRegion[] {
  return features(raw, SOURCES.regions.url).map(({ geometry, properties }, i) => {
    const where = `${SOURCES.regions.url} feature ${i}`;
    return {
      featurecla: text(properties, 'FEATURECLA', where),
      name: text(properties, 'NAME', where),
      nameEn: optionalText(properties, 'NAME_EN', where),
      polygons: areas(geometry, where),
    };
  });
}

function parseElevationPoints(raw: unknown): NaturalEarthPoint[] {
  return features(raw, SOURCES.elevationPoints.url).map(({ geometry, properties }, i) => {
    const where = `${SOURCES.elevationPoints.url} feature ${i}`;
    const { elevation } = properties;
    if (typeof elevation !== 'number') throw new Error(`${where}: elevation missing`);
    if (geometry.type !== 'Point') {
      throw new Error(`${where}: unexpected geometry ${String(geometry.type)}`);
    }
    const [at] = positions([geometry.coordinates], where);
    return {
      featurecla: text(properties, 'featurecla', where),
      name: optionalText(properties, 'name', where),
      elevation,
      at: at as LonLat,
    };
  });
}

function parseLakes(raw: unknown): NaturalEarthLake[] {
  return features(raw, SOURCES.lakes.url).map(({ geometry, properties }, i) => {
    const where = `${SOURCES.lakes.url} feature ${i}`;
    return {
      featurecla: text(properties, 'featurecla', where),
      name: optionalText(properties, 'name', where),
      polygons: areas(geometry, where),
    };
  });
}

function parseElevation(body: Buffer): ElevationGrid {
  const { columns, rows } = ELEVATION_GRID;
  if (body.length !== columns * rows * 2) {
    throw new Error(`${SOURCES.elevation.url}: expected ${columns} x ${rows} int16 values`);
  }
  const heights = new Int16Array(columns * rows);
  for (let i = 0; i < heights.length; i++) heights[i] = body.readInt16LE(i * 2);
  return heights;
}

interface Feature {
  geometry: { type: unknown; coordinates: unknown };
  properties: Record<string, unknown>;
}

function features(raw: unknown, where: string): Feature[] {
  const collection = raw as { type?: unknown; features?: unknown } | null;
  if (collection?.type !== 'FeatureCollection')
    throw new Error(`${where}: not a FeatureCollection`);
  return array(collection.features, where).map((entry, i) =>
    feature(entry, `${where} feature ${i}`),
  );
}

function feature(raw: unknown, where: string): Feature {
  const entry = raw as { geometry?: unknown; properties?: unknown } | null;
  const geometry = entry?.geometry as Feature['geometry'] | null | undefined;
  const properties = entry?.properties;
  if (typeof geometry !== 'object' || geometry === null) throw new Error(`${where}: no geometry`);
  if (typeof properties !== 'object' || properties === null) {
    throw new Error(`${where}: no properties`);
  }
  return { geometry, properties: properties as Record<string, unknown> };
}

function text(properties: Record<string, unknown>, key: string, where: string): string {
  const value = properties[key];
  if (typeof value !== 'string') throw new Error(`${where}: ${key} missing`);
  return value;
}

function optionalText(
  properties: Record<string, unknown>,
  key: string,
  where: string,
): string | null {
  const value = properties[key] ?? null;
  if (value !== null && typeof value !== 'string') throw new Error(`${where}: bad ${key}`);
  return value;
}

function areas(geometry: Feature['geometry'], where: string): LonLatPolygon[] {
  if (geometry.type === 'Polygon') return [polygon(geometry.coordinates, where)];
  if (geometry.type === 'MultiPolygon') {
    return array(geometry.coordinates, where).map((entry) => polygon(entry, where));
  }
  throw new Error(`${where}: unexpected geometry ${String(geometry.type)}`);
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
