import { resolve } from 'node:path';
import {
  MAP_VERSION,
  type GameMap,
  type MapLine,
  type MultiPolygon,
  type Point,
  type Province,
  type ProvinceId,
  type River,
  type Ring,
} from '../../src/sim/map.ts';
import type { City } from './cities.ts';
import { area, clipLine, closestOnBoundary, contains, distance, intersection } from './geometry.ts';
import { EXTENT_CORNERS, mapPlane, round, type Plane } from './projection.ts';
import { onExtentEdge, partition, relations } from './provinces.ts';
import type { LonLat, LonLatPolygon, NaturalEarthRiver } from './sources.ts';

export const MAP_FILE = resolve(import.meta.dirname, '../../data/map/map.json');

export const MAX_CITY_MOVE_KM = 15;
const CITY_INSETS_KM = [1, 0.5, 0.25, 0.1];
const RIVER_CLASSES: readonly string[] = ['River', 'Lake Centerline'];
const MAX_RIVER_SCALERANK = 6;
const NOT_A_RIVER = /canal|csatorna/i;

export interface CityMove {
  id: string;
  distance: number;
}

export interface OrphanMergeLog {
  from: string;
  to: string;
  area: number;
  border: number;
}

export interface IslandJoinLog {
  to: string;
  area: number;
  distance: number;
  at: LonLat;
}

export interface MapBuild {
  map: GameMap;
  moves: CityMove[];
  merges: OrphanMergeLog[];
  joins: IslandJoinLog[];
}

export function buildMap(
  cities: City[],
  land: LonLatPolygon[],
  rivers: NaturalEarthRiver[],
): MapBuild {
  const plane = mapPlane();
  const landArea = landInExtent(land, plane);

  const projected = cities.map((city) => plane.toPlane([city.lon, city.lat]));
  const placed = projected.map((point) => placeOnLand(point, landArea));
  const moves = cities
    .map((city, i) => ({
      id: city.id,
      distance: distance(projected[i] as Point, placed[i] as Point),
    }))
    .filter((move) => move.distance > 0);
  const tooFar = moves.filter((move) => move.distance > MAX_CITY_MOVE_KM);
  if (tooFar.length > 0) {
    const list = tooFar.map((move) => `${move.id} ${move.distance.toFixed(1)} km`).join(', ');
    throw new Error(`cities more than ${MAX_CITY_MOVE_KM} km from land: ${list}`);
  }

  const { territories, island, merges, joins } = partition(landArea, placed);
  const { neighbours, coastal } = relations(territories, plane.extent);
  const idOf = (seed: number) => (cities[seed] as City).id as ProvinceId;

  const provinces = cities
    .map((city, i): Province => {
      const outline = roundOutline(territories[i] ?? []);
      if (outline.length === 0) throw new Error(`province ${city.id} has no land`);
      return {
        id: city.id as ProvinceId,
        name: city.name,
        pleiadesId: city.pleiadesId,
        owner: city.owner,
        capital: city.capital,
        port: city.port,
        coastal: coastal[i] ?? false,
        island: island[i] ?? false,
        city: roundPoint(placed[i] as Point),
        area: Math.round(area(territories[i] ?? [])),
        neighbours: (neighbours[i] ?? []).map(idOf).sort(compare),
        outline,
      };
    })
    .sort((a, b) => compare(a.id, b.id));

  return {
    map: {
      version: MAP_VERSION,
      unit: 'km',
      projection: plane.projection,
      width: plane.width,
      height: plane.height,
      extent: roundRing(plane.extent)[0] ?? [],
      provinces,
      coastline: coastline(landArea, plane.extent).flatMap(roundLine),
      rivers: riverLines(rivers, plane),
    },
    moves,
    merges: merges.map((merge) => ({
      from: idOf(merge.cell),
      to: idOf(merge.seed),
      area: merge.area,
      border: merge.border,
    })),
    joins: joins.map((join) => ({
      to: idOf(join.seed),
      area: join.area,
      distance: join.distance,
      at: plane.toLonLat(join.at),
    })),
  };
}

export function landInExtent(land: LonLatPolygon[], plane: Plane = mapPlane()): MultiPolygon {
  const near = land.filter(([outer = []]) => touchesExtent(outer));
  // Whole polygons are projected before clipping; none of these crosses the projection's cut
  // meridian at lon0 ± 180°, so each projects to one simple shape.
  const projected = near.map((polygon) => polygon.map((ring) => ring.map(plane.toPlane)));
  return intersection(projected, [[plane.extent]]);
}

const EXTENT_LON = EXTENT_CORNERS.map(([lon]) => lon);
const EXTENT_LAT = EXTENT_CORNERS.map(([, lat]) => lat);
const EXTENT_BOX = {
  west: Math.min(...EXTENT_LON),
  east: Math.max(...EXTENT_LON),
  south: Math.min(...EXTENT_LAT),
  north: Math.max(...EXTENT_LAT),
};

function touchesExtent(positions: LonLat[]): boolean {
  let [west, east, south, north] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [lon, lat] of positions) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return (
    west <= EXTENT_BOX.east &&
    east >= EXTENT_BOX.west &&
    south <= EXTENT_BOX.north &&
    north >= EXTENT_BOX.south
  );
}

function placeOnLand(point: Point, land: MultiPolygon): Point {
  if (contains(land, point)) return point;
  const coast = closestOnBoundary(land, point);
  if (coast) {
    const gap = distance(point, coast);
    for (const inset of CITY_INSETS_KM) {
      const step = inset / gap;
      const candidate: Point = [
        coast[0] + (coast[0] - point[0]) * step,
        coast[1] + (coast[1] - point[1]) * step,
      ];
      if (contains(land, candidate)) return candidate;
    }
  }
  throw new Error(`no land next to ${point.join(', ')}`);
}

function coastline(land: MultiPolygon, extent: Ring): MapLine[] {
  const lines: MapLine[] = [];
  for (const ring of land.flat()) {
    const n = ring.length;
    const at = (i: number) => ring[i % n] as Point;
    const onEdge = ring.map((a, i) => {
      const b = at(i + 1);
      return onExtentEdge(extent, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    });
    const start = onEdge.indexOf(true);
    if (start < 0) {
      lines.push([...ring, at(0)]);
      continue;
    }
    let current: MapLine = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (onEdge[i]) {
        if (current.length >= 2) lines.push(current);
        current = [];
      } else {
        if (current.length === 0) current.push(at(i));
        current.push(at(i + 1));
      }
    }
  }
  return lines;
}

function riverLines(rivers: NaturalEarthRiver[], plane: Plane): River[] {
  return rivers
    .filter(
      (river) =>
        RIVER_CLASSES.includes(river.featurecla) &&
        river.scalerank <= MAX_RIVER_SCALERANK &&
        !NOT_A_RIVER.test(river.name ?? ''),
    )
    .flatMap((river) =>
      river.lines
        .filter(touchesExtent)
        .flatMap((line) => clipLine(line.map(plane.toPlane), plane.extent))
        .flatMap(roundLine)
        .map((line) => ({ name: river.name ?? '', line })),
    )
    .sort((a, b) => compare(a.name, b.name) || comparePoints(a.line[0], b.line[0]));
}

function roundPoint([x, y]: Point): Point {
  return [round(x), round(y)];
}

function roundPoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const rounded = roundPoint(point);
    if (comparePoints(out[out.length - 1], rounded) !== 0) out.push(rounded);
  }
  return out;
}

function roundLine(line: MapLine): MapLine[] {
  const out = roundPoints(line);
  return out.length >= 2 ? [out] : [];
}

function roundRing(ring: Ring): Ring[] {
  const out = roundPoints(ring);
  while (out.length > 1 && comparePoints(out[0], out[out.length - 1]) === 0) out.pop();
  return out.length >= 3 ? [out] : [];
}

function roundOutline(polygons: MultiPolygon): MultiPolygon {
  return polygons.flatMap(([outer = [], ...holes]) => {
    const [rounded] = roundRing(outer);
    return rounded ? [[rounded, ...holes.flatMap(roundRing)]] : [];
  });
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePoints(a: Point | undefined, b: Point | undefined): number {
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  return a[0] - b[0] || a[1] - b[1];
}

/** One top-level key, province, line, or river per line, so diffs of the file stay readable. */
export function serializeMap(map: GameMap): string {
  const items = (values: unknown[]) =>
    values.length === 0
      ? '[]'
      : `[\n${values.map((v) => `    ${JSON.stringify(v)}`).join(',\n')}\n  ]`;
  const fields: [keyof GameMap, string][] = [
    ['version', JSON.stringify(map.version)],
    ['unit', JSON.stringify(map.unit)],
    ['projection', JSON.stringify(map.projection)],
    ['width', JSON.stringify(map.width)],
    ['height', JSON.stringify(map.height)],
    ['extent', JSON.stringify(map.extent)],
    ['provinces', items(map.provinces)],
    ['coastline', items(map.coastline)],
    ['rivers', items(map.rivers)],
  ];
  return `{\n${fields.map(([key, value]) => `  "${key}": ${value}`).join(',\n')}\n}\n`;
}
