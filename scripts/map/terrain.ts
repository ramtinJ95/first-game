import { contours } from 'd3-contour';
import {
  TERRAIN_KINDS,
  type MapLine,
  type MultiPolygon,
  type Peak,
  type Point,
  type River,
  type TerrainArea,
  type TerrainKind,
} from '../../src/sim/map.ts';
import {
  area,
  boxesOverlap,
  boxOf,
  compare,
  contains,
  difference as exactDifference,
  intersection as exactIntersection,
  roundOutline,
  roundPoint,
  simplify as exactSimplify,
  union as exactUnion,
} from './geometry.ts';
import { EXTENT_BOX, touchesExtent, type Plane } from './projection.ts';
import {
  ELEVATION_GRID,
  type ElevationGrid,
  type LonLatPolygon,
  type NaturalEarthPoint,
  type Sources,
} from './sources.ts';

export const SIMPLIFY_KM = 2;
/** Lakes are seen whole at the closest zoom; the relief's 2 km tolerance erased their bays. */
export const LAKE_SIMPLIFY_KM = 0.1;
export const MIN_AREA_KM2 = 50;
const GRID_MARGIN_DEG = 1;
/** Relief spans the nodes with dr² + dc² up to this, a radius of 2 nodes or about 37 km. */
const RELIEF_REACH_SQUARED = 5;
/**
 * The mountain index is the larger of relief / MOUNTAIN_RELIEF_M and elevation /
 * MOUNTAIN_ELEVATION_M. The hill index is relief / HILL_RELIEF_M. Each outline is index 1.
 */
export const MOUNTAIN_RELIEF_M = 1000;
export const MOUNTAIN_ELEVATION_M = 2000;
export const HILL_RELIEF_M = 400;
const RANGE_CLASS = 'Range/mtn';
const DESERT_CLASS = 'Desert';
/** River valleys and deltas are watered land. Desert keeps this far from every river line. */
export const DESERT_RIVER_KM = 15;
const DELTA_CLASS = 'Delta';
const BUFFER_SIDES = 16;
/** RESOLVE biomes: temperate broadleaf and mixed, temperate conifer, boreal. */
export const FOREST_BIOMES: readonly number[] = [4, 5, 6];
/** Forest steppe is open grassland with groves, and the biome lists it as forest. */
const NOT_FOREST = /steppe/i;
/**
 * Italy's woods are Mediterranean ecoregions, biome 12, which also covers the scrub of
 * Iberia, Greece, Anatolia, and the Maghreb. These three are admitted by name.
 */
export const FOREST_ECOREGIONS: readonly string[] = [
  'Italian sclerophyllous and semi-deciduous forests',
  'South Apennine mixed montane forests',
  'Tyrrhenian-Adriatic sclerophyllous and mixed forests',
];
/** Reservoirs are modern dams. */
export const LAKE_CLASSES: readonly string[] = ['Lake', 'Alkaline Lake'];
/** Natural Earth lists a modern polder lake and a lagoon of the Sea of Azov as lakes. */
const NOT_LAKES: readonly string[] = ['IJsselmeer', 'Syvash'];
const PEAK_CLASS = 'mountain';
/** Drops national high points such as the Vaalserberg (321 m). */
export const MIN_PEAK_M = 1000;

/**
 * Chained set operations hand polygon-clipping near-degenerate input on which it loses segments
 * ("Unable to find segment"). Snapping every result to a shared 1 mm grid avoids that.
 */
const SNAP_KM = 1e-6;

function snap(polygons: MultiPolygon): MultiPolygon {
  const to = (value: number) => Math.round(value / SNAP_KM) * SNAP_KM;
  return polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [to(x), to(y)])));
}

const difference = (subject: MultiPolygon, ...clips: MultiPolygon[]) =>
  snap(exactDifference(subject, ...clips));
const intersection = (subject: MultiPolygon, ...clips: MultiPolygon[]) =>
  snap(exactIntersection(subject, ...clips));
const union = (...parts: MultiPolygon[]) => snap(exactUnion(...parts));
const simplify = (polygons: MultiPolygon) => snap(exactSimplify(polygons, SIMPLIFY_KM));

interface Claim {
  name: string;
  outline: MultiPolygon;
}

/**
 * Mountains and hills take their outlines from elevation and their names from the Natural Earth
 * ranges they fall in. Every outline is simplified, then clipped to the land, then rounded.
 */
export function terrainAreas(
  sources: Pick<Sources, 'regions' | 'elevation' | 'ecoregions' | 'lakes'>,
  plane: Plane,
  land: MultiPolygon,
  rivers: River[],
): TerrainArea[] {
  const toPlane = (polygons: LonLatPolygon[], tolerance = SIMPLIFY_KM): MultiPolygon =>
    snap(
      exactSimplify(
        polygons
          .filter(([outer = []]) => touchesExtent(outer))
          .map((polygon) => polygon.map((ring) => ring.map(plane.toPlane))),
        tolerance,
      ),
    );
  const regions = (featurecla: string): Claim[] =>
    sources.regions
      .filter((region) => region.featurecla === featurecla)
      .map((region) => ({ name: region.nameEn || region.name, outline: toPlane(region.polygons) }));

  const relief = reliefShapes(sources.elevation, plane);
  const ranges = carve(regions(RANGE_CLASS));
  const inRanges = (shape: MultiPolygon): Claim[] => [
    ...ranges.map((range) => ({ name: range.name, outline: intersection(range.outline, shape) })),
    { name: '', outline: subtract(shape, ranges) },
  ];
  const forests = sources.ecoregions
    .filter(
      (region) =>
        (FOREST_BIOMES.includes(region.biome) && !NOT_FOREST.test(region.name)) ||
        FOREST_ECOREGIONS.includes(region.name),
    )
    .map((region) => ({ name: region.name, outline: toPlane(region.polygons) }));
  const lakes = sources.lakes
    .filter(
      (lake) => LAKE_CLASSES.includes(lake.featurecla) && !NOT_LAKES.includes(lake.name ?? ''),
    )
    .map((lake) => ({ name: lake.name ?? '', outline: toPlane(lake.polygons, LAKE_SIMPLIFY_KM) }));

  const deserts = regions(DESERT_CLASS);
  const claims: Record<TerrainKind, Claim[]> = {
    mountains: inRanges(relief.mountains),
    hills: inRanges(difference(relief.hills, relief.mountains)),
    desert: carve(deserts, waterways(deserts, rivers, regions(DELTA_CLASS))),
    forest: carve(forests),
    lake: carve(lakes),
  };
  const landParts = land.map((polygon) => ({ polygon, box: boxOf([polygon]) }));
  return TERRAIN_KINDS.flatMap((kind) =>
    merge(claims[kind]).flatMap(({ name, outline }): TerrainArea[] => {
      const box = boxOf(outline);
      const near = landParts.filter((part) => boxesOverlap(part.box, box));
      const kept = intersection(
        outline,
        near.map((part) => part.polygon),
      ).filter((polygon) => area([polygon]) >= MIN_AREA_KM2);
      const rounded = roundOutline(kept);
      return rounded.length > 0 ? [{ kind, name, outline: rounded }] : [];
    }),
  );
}

/**
 * In ascending area, each claim keeps only what no smaller claim of its list took, and nothing of
 * what `before` already took.
 */
function carve(claims: Claim[], before: MultiPolygon[] = []): Claim[] {
  const taken = before.map((outline) => ({ outline, box: boxOf(outline) }));
  return claims
    .map((claim) => ({ claim, size: area(claim.outline) }))
    .filter(({ size }) => size > 0)
    .sort((a, b) => a.size - b.size || compare(a.claim.name, b.claim.name))
    .flatMap(({ claim }) => {
      const outline = subtract(claim.outline, taken);
      taken.push({ outline: claim.outline, box: boxOf(claim.outline) });
      return outline.length > 0 ? [{ name: claim.name, outline }] : [];
    });
}

function subtract(shape: MultiPolygon, others: { outline: MultiPolygon }[]): MultiPolygon {
  const box = boxOf(shape);
  const near = others
    .filter((other) => boxesOverlap(boxOf(other.outline), box))
    .map((other) => other.outline);
  return near.length > 0 ? difference(shape, ...near) : shape;
}

/** The deltas, and the land within `DESERT_RIVER_KM` of each river line that reaches a desert. */
function waterways(deserts: Claim[], rivers: River[], deltas: Claim[]): MultiPolygon[] {
  const boxes = deserts.map((desert) => boxOf(desert.outline));
  const reaching = rivers
    .map((river) => river.line)
    .filter((line) => {
      const box = boxOf([[line]]);
      return boxes.some((desert) => boxesOverlap(desert, box));
    });
  const strips = reaching.map((line) => union(...lineBuffer(line, DESERT_RIVER_KM)));
  return [...strips, ...deltas.map((delta) => delta.outline)].filter((shape) => shape.length > 0);
}

/** A quadrilateral along each segment and a polygon of `BUFFER_SIDES` around each vertex. */
function lineBuffer(line: MapLine, radius: number): MultiPolygon[] {
  const pieces: MultiPolygon[] = line.map(([x, y]) => [
    [
      Array.from({ length: BUFFER_SIDES }, (_, k): Point => {
        const angle = (2 * Math.PI * k) / BUFFER_SIDES;
        return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
      }),
    ],
  ]);
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i] as Point;
    const [bx, by] = line[i + 1] as Point;
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const nx = (-(by - ay) / length) * radius;
    const ny = ((bx - ax) / length) * radius;
    pieces.push([
      [
        [
          [ax + nx, ay + ny],
          [bx + nx, by + ny],
          [bx - nx, by - ny],
          [ax - nx, ay - ny],
        ],
      ],
    ]);
  }
  return pieces;
}

/** One claim per name, sorted by name. */
function merge(claims: Claim[]): Claim[] {
  const byName = new Map<string, MultiPolygon[]>();
  for (const { name, outline } of claims) {
    if (outline.length === 0) continue;
    const outlines = byName.get(name);
    if (outlines) outlines.push(outline);
    else byName.set(name, [outline]);
  }
  return [...byName]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, outlines]) => ({
      name,
      outline: outlines.length === 1 ? (outlines[0] ?? []) : union(...outlines),
    }));
}

/**
 * From the ETOPO10 nodes around the extent: relief is the spread of heights above sea level
 * within the reach of a node. Nodes at or below sea level are neither mountains nor hills.
 */
function reliefShapes(
  heights: ElevationGrid,
  plane: Plane,
): { mountains: MultiPolygon; hills: MultiPolygon } {
  const { columns, perDegree } = ELEVATION_GRID;
  const firstColumn = Math.floor((EXTENT_BOX.west - GRID_MARGIN_DEG + 180) * perDegree);
  const lastColumn = Math.ceil((EXTENT_BOX.east + GRID_MARGIN_DEG + 180) * perDegree);
  const firstRow = Math.floor((90 - EXTENT_BOX.north - GRID_MARGIN_DEG) * perDegree);
  const lastRow = Math.ceil((90 - EXTENT_BOX.south + GRID_MARGIN_DEG) * perDegree);
  const width = lastColumn - firstColumn + 1;
  const height = lastRow - firstRow + 1;
  const z = (row: number, column: number) =>
    heights[(firstRow + row) * columns + firstColumn + column] ?? 0;

  const reach: [number, number][] = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr * dr + dc * dc <= RELIEF_REACH_SQUARED) reach.push([dr, dc]);
    }
  }
  const mountain: number[] = [];
  const hill: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const here = z(row, column);
      let low = Infinity;
      let high = -Infinity;
      for (const [dr, dc] of reach) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || r >= height || c < 0 || c >= width) continue;
        const above = Math.max(0, z(r, c));
        low = Math.min(low, above);
        high = Math.max(high, above);
      }
      const relief = high - low;
      mountain.push(
        here > 0 ? Math.max(relief / MOUNTAIN_RELIEF_M, here / MOUNTAIN_ELEVATION_M) : 0,
      );
      hill.push(here > 0 ? relief / HILL_RELIEF_M : 0);
    }
  }

  const west = -180 + firstColumn / perDegree;
  const north = 90 - firstRow / perDegree;
  const outline = (index: number[]): MultiPolygon => {
    const [contour] = contours().size([width, height]).thresholds([1])(index);
    // d3-contour places the value of node i at i + 0.5.
    const polygons = (contour?.coordinates ?? []).map((polygon) =>
      polygon.map((ring) =>
        ring.map(([x = 0, y = 0]) =>
          plane.toPlane([west + (x - 0.5) / perDegree, north - (y - 0.5) / perDegree]),
        ),
      ),
    );
    return simplify(polygons);
  };
  return { mountains: outline(mountain), hills: outline(hill) };
}

/** Named mountain points of at least `MIN_PEAK_M`, highest first. */
export function peaksOnLand(points: NaturalEarthPoint[], plane: Plane, land: MultiPolygon): Peak[] {
  return points
    .flatMap((point): Peak[] => {
      const { name } = point;
      if (point.featurecla !== PEAK_CLASS || !name || point.elevation < MIN_PEAK_M) return [];
      const at = roundPoint(plane.toPlane(point.at));
      return contains(land, at) ? [{ name, height: point.elevation, at }] : [];
    })
    .sort((a, b) => b.height - a.height || compare(a.name, b.name));
}

/** The height of the ground in metres at a map point, between the ETOPO10 nodes round it, 0 at sea. */
export function groundHeight(heights: ElevationGrid, plane: Plane): (point: Point) => number {
  const { columns, perDegree } = ELEVATION_GRID;
  const z = (row: number, column: number) => Math.max(0, heights[row * columns + column] ?? 0);
  return (point) => {
    const [lon, lat] = plane.toLonLat(point);
    const x = (lon + 180) * perDegree;
    const y = (90 - lat) * perDegree;
    const column = Math.floor(x);
    const row = Math.floor(y);
    const tx = x - column;
    const ty = y - row;
    const top = z(row, column) * (1 - tx) + z(row, column + 1) * tx;
    const bottom = z(row + 1, column) * (1 - tx) + z(row + 1, column + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}
