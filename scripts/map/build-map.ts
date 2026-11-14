import { resolve } from 'node:path';
import {
  MAP_VERSION,
  type GameMap,
  type MapLine,
  type MultiPolygon,
  type Point,
  type Province,
  type River,
  type Ring,
} from '../../src/sim/map.ts';
import type { ProvinceId } from '../../src/sim/ids.ts';
import type { City } from './cities.ts';
import {
  area,
  boxesOverlap,
  boxOf,
  clipLine,
  closestOnBoundary,
  compare,
  comparePoints,
  conform,
  contains,
  distance,
  intersection,
  roundLine,
  roundOutline,
  roundPoint,
  roundRing,
} from './geometry.ts';
import { mapPlane, touchesExtent, type Plane } from './projection.ts';
import { onExtentEdge, partition, relations } from './provinces.ts';
import { chooseSettlements } from './settlements.ts';
import type { LonLat, LonLatPolygon, NaturalEarthRiver, Sources } from './sources.ts';
import { groundHeight, peaksOnLand, terrainAreas } from './terrain.ts';

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

/** What re-cutting the borders along the land did to one province, in km². */
export interface BorderChange {
  id: ProvinceId;
  gained: number;
  lost: number;
  /** The land it lost, by the province that took it. */
  to: { id: ProvinceId; area: number }[];
}

export interface MapBuild {
  map: GameMap;
  moves: CityMove[];
  merges: OrphanMergeLog[];
  joins: IslandJoinLog[];
  /** Each province as the straight borders between the cities' Voronoi cells cut it. */
  straight: Map<ProvinceId, MultiPolygon>;
  borders: BorderChange[];
}

export function buildMap(cities: City[], sources: Sources): MapBuild {
  const plane = mapPlane();
  const landArea = landInExtent(sources.land, plane);

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

  const rivers = riverLines(sources.rivers, plane);
  const { land, territories, straight, island, merges, joins } = partition(landArea, placed, {
    rivers: rivers.map((river) => river.line),
    height: groundHeight(sources.elevation, plane),
    extent: plane.extent,
  });
  const { neighbours, coastal } = relations(territories, plane.extent);
  const idOf = (seed: number) => (cities[seed] as City).id as ProvinceId;

  const outlines = conform(territories.map(roundOutline));
  const provinces = cities
    .map((city, i): Province => {
      const outline = outlines[i] ?? [];
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
      coastline: coastline(land, plane.extent).flatMap(roundLine),
      rivers,
      terrain: terrainAreas(sources, plane, landArea, rivers),
      peaks: peaksOnLand(sources.elevationPoints, plane, landArea),
      settlements: chooseSettlements(sources.settlementCandidates, provinces, plane, landArea),
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
    straight: new Map(straight.map((outline, seed) => [idOf(seed), roundOutline(outline)])),
    borders: borderChanges(
      cities.map((_, seed) => idOf(seed)),
      straight,
      territories,
    ),
  };
}

/** A move smaller than this is the sliver the coast's new vertices leave between two cuts. */
const MOVE_FLOOR_KM2 = 1;

function borderChanges(
  ids: ProvinceId[],
  straight: MultiPolygon[],
  bent: MultiPolygon[],
): BorderChange[] {
  const before = straight.map((outline) => ({ outline, box: boxOf(outline) }));
  const after = bent.map((outline) => ({ outline, box: boxOf(outline) }));
  const moved = ids.map((_, i) =>
    ids.map((_, j) => {
      const from = before[i];
      const to = after[j];
      if (i === j || !from || !to || !boxesOverlap(from.box, to.box)) return 0;
      const taken = area(intersection(from.outline, to.outline));
      return taken >= MOVE_FLOOR_KM2 ? taken : 0;
    }),
  );
  return ids
    .map((id, i): BorderChange => {
      const lostTo = moved[i] ?? [];
      return {
        id,
        gained: moved.reduce((sum, row) => sum + (row[i] ?? 0), 0),
        lost: lostTo.reduce((sum, taken) => sum + taken, 0),
        to: ids
          .flatMap((other, j) =>
            (lostTo[j] ?? 0) > 0 ? [{ id: other, area: lostTo[j] ?? 0 }] : [],
          )
          .sort((a, b) => b.area - a.area),
      };
    })
    .sort((a, b) => compare(a.id, b.id));
}

export function landInExtent(land: LonLatPolygon[], plane: Plane = mapPlane()): MultiPolygon {
  const near = land.filter(([outer = []]) => touchesExtent(outer));
  // Whole polygons are projected before clipping; none of these crosses the projection's cut
  // meridian at lon0 ± 180°, so each projects to one simple shape.
  const projected = near.map((polygon) => polygon.map((ring) => ring.map(plane.toPlane)));
  return intersection(projected, [[plane.extent]]);
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

/** One top-level key or one item of a list per line, so diffs of the file stay readable. */
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
    ['terrain', items(map.terrain)],
    ['peaks', items(map.peaks)],
    ['settlements', items(map.settlements)],
  ];
  return `{\n${fields.map(([key, value]) => `  "${key}": ${value}`).join(',\n')}\n}\n`;
}
