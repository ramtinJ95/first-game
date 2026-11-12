export const POWERS = ['rome', 'carthage', 'macedon', 'egypt', 'persia'] as const;
export type PowerId = (typeof POWERS)[number];
export type StartingOwner = PowerId | 'independent';

export function isStartingOwner(value: unknown): value is StartingOwner {
  return value === 'independent' || POWERS.some((power) => power === value);
}

export type ProvinceId = string & { readonly __brand: 'ProvinceId' };

/** Map plane coordinates in km: x grows east, y grows south, origin at the top-left corner. */
export type Point = [x: number, y: number];
/** A closed ring stored without repeating its first point. */
export type Ring = Point[];
/** The first ring is the outer ring, the rest are holes. */
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];
/** An open polyline. A closed loop repeats its first point at the end. */
export type MapLine = Point[];

export const MAP_VERSION = 1;

export interface Projection {
  kind: 'albers-equal-area-conic';
  /** Sphere radius in km. */
  radius: number;
  lon0: number;
  lat0: number;
  parallels: [number, number];
  /** Projected coordinates (km, y grows north) of the map's top-left corner. */
  origin: [x: number, y: number];
}

export interface Province {
  id: ProvinceId;
  name: string;
  pleiadesId: number;
  owner: StartingOwner;
  capital: boolean;
  port: boolean;
  coastal: boolean;
  island: boolean;
  city: Point;
  /** km². */
  area: number;
  neighbours: ProvinceId[];
  outline: MultiPolygon;
}

export interface River {
  name: string;
  line: MapLine;
}

/** Static map data, built by `npm run build:map`. It is not part of the game state. */
export interface GameMap {
  version: typeof MAP_VERSION;
  unit: 'km';
  projection: Projection;
  width: number;
  height: number;
  extent: Ring;
  provinces: Province[];
  coastline: MapLine[];
  rivers: River[];
}

export function parseMap(raw: unknown): GameMap {
  const map = record(raw, '');
  if (map.version !== MAP_VERSION) fail('.version', `expected ${MAP_VERSION}`);
  if (map.unit !== 'km') fail('.unit', "expected 'km'");
  const provinces = list(map.provinces, '.provinces', province);
  const ids = new Set<string>();
  for (const [i, { id }] of provinces.entries()) {
    if (ids.has(id)) fail(`.provinces[${i}].id`, `duplicate id ${id}`);
    ids.add(id);
  }
  for (const [i, { id, neighbours }] of provinces.entries()) {
    for (const [j, neighbour] of neighbours.entries()) {
      const path = `.provinces[${i}].neighbours[${j}]`;
      if (!ids.has(neighbour)) fail(path, `unknown province ${neighbour}`);
      if (neighbour === id) fail(path, 'a province cannot neighbour itself');
    }
  }
  return {
    version: MAP_VERSION,
    unit: 'km',
    projection: projection(map.projection, '.projection'),
    width: positive(map.width, '.width'),
    height: positive(map.height, '.height'),
    extent: ring(map.extent, '.extent'),
    provinces,
    coastline: list(map.coastline, '.coastline', line),
    rivers: list(map.rivers, '.rivers', river),
  };
}

function projection(raw: unknown, path: string): Projection {
  const value = record(raw, path);
  if (value.kind !== 'albers-equal-area-conic') {
    fail(`${path}.kind`, "expected 'albers-equal-area-conic'");
  }
  const parallels = list(value.parallels, `${path}.parallels`, num);
  const [lat1, lat2] = parallels;
  if (lat1 === undefined || lat2 === undefined || parallels.length !== 2) {
    fail(`${path}.parallels`, 'expected two latitudes');
  }
  return {
    kind: 'albers-equal-area-conic',
    radius: positive(value.radius, `${path}.radius`),
    lon0: num(value.lon0, `${path}.lon0`),
    lat0: num(value.lat0, `${path}.lat0`),
    parallels: [lat1, lat2],
    origin: point(value.origin, `${path}.origin`),
  };
}

function province(raw: unknown, path: string): Province {
  const value = record(raw, path);
  const id = str(value.id, `${path}.id`);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`${path}.id`, `expected a kebab-case id, got ${id}`);
  const owner = value.owner;
  if (!isStartingOwner(owner)) fail(`${path}.owner`, `unknown owner ${String(owner)}`);
  const pleiadesId = num(value.pleiadesId, `${path}.pleiadesId`);
  if (!Number.isInteger(pleiadesId)) fail(`${path}.pleiadesId`, 'expected an integer');
  return {
    id: id as ProvinceId,
    name: str(value.name, `${path}.name`),
    pleiadesId,
    owner,
    capital: bool(value.capital, `${path}.capital`),
    port: bool(value.port, `${path}.port`),
    coastal: bool(value.coastal, `${path}.coastal`),
    island: bool(value.island, `${path}.island`),
    city: point(value.city, `${path}.city`),
    area: positive(value.area, `${path}.area`),
    neighbours: list(value.neighbours, `${path}.neighbours`, str) as ProvinceId[],
    outline: nonEmpty(list(value.outline, `${path}.outline`, polygon), `${path}.outline`),
  };
}

function river(raw: unknown, path: string): River {
  const value = record(raw, path);
  return { name: str(value.name, `${path}.name`), line: line(value.line, `${path}.line`) };
}

function polygon(raw: unknown, path: string): Polygon {
  return nonEmpty(list(raw, path, ring), path);
}

function ring(raw: unknown, path: string): Ring {
  const points = list(raw, path, point);
  if (points.length < 3) fail(path, `expected at least 3 points, got ${points.length}`);
  return points;
}

function line(raw: unknown, path: string): MapLine {
  const points = list(raw, path, point);
  if (points.length < 2) fail(path, `expected at least 2 points, got ${points.length}`);
  return points;
}

function point(raw: unknown, path: string): Point {
  if (!Array.isArray(raw) || raw.length !== 2) fail(path, 'expected a point [x, y]');
  return [num(raw[0], `${path}[0]`), num(raw[1], `${path}[1]`)];
}

function list<T>(raw: unknown, path: string, item: (raw: unknown, path: string) => T): T[] {
  if (!Array.isArray(raw)) fail(path, 'expected an array');
  return raw.map((entry: unknown, i) => item(entry, `${path}[${i}]`));
}

function nonEmpty<T>(items: T[], path: string): T[] {
  if (items.length === 0) fail(path, 'expected at least one entry');
  return items;
}

function record(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    fail(path, 'expected an object');
  return raw as Record<string, unknown>;
}

function str(raw: unknown, path: string): string {
  if (typeof raw !== 'string') fail(path, 'expected a string');
  return raw;
}

function bool(raw: unknown, path: string): boolean {
  if (typeof raw !== 'boolean') fail(path, 'expected a boolean');
  return raw;
}

function num(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(path, 'expected a finite number');
  return raw;
}

function positive(raw: unknown, path: string): number {
  const value = num(raw, path);
  if (value <= 0) fail(path, 'expected a positive number');
  return value;
}

function fail(path: string, why: string): never {
  throw new Error(`map${path}: ${why}`);
}
