import { Delaunay } from 'd3-delaunay';
import type { MultiPolygon, Point, Polygon, Ring } from '../../src/sim/map.ts';
import { recut, type BorderTerrain } from './borders.ts';
import {
  area,
  borderLengths,
  boundaryDistance,
  boxDistance,
  boxOf,
  distanceToBoundary,
  intersection,
  polygonContains,
  union,
} from './geometry.ts';

export const NEIGHBOUR_MIN_BORDER_KM = 2;
export const COASTAL_MIN_SEA_KM = 5;
const ON_EXTENT_EDGE_KM = 0.01;
/** Borders cut from neighbouring clips coincide to float noise; across a strait they are apart. */
const TOUCH_KM = 0.01;

export interface OrphanMerge {
  /** The seed whose Voronoi cell produced the orphan piece. */
  cell: number;
  /** The seed whose province took the piece. */
  seed: number;
  area: number;
  border: number;
}

export interface IslandJoin {
  seed: number;
  area: number;
  distance: number;
  /** A point on the joined land's coast, for the log. */
  at: Point;
}

export interface Partition {
  /**
   * The land, with a vertex on the coast wherever a re-cut border meets it, so the
   * provinces' coasts and the coastline drawn from this land are one line.
   */
  land: MultiPolygon;
  /** One area per seed, in seed order. */
  territories: MultiPolygon[];
  /** The areas the straight borders between the seeds' Voronoi cells give, which `territories` re-cuts along the land. */
  straight: MultiPolygon[];
  /** Seeds alone on their land component. */
  island: boolean[];
  merges: OrphanMerge[];
  joins: IslandJoin[];
}

interface Piece {
  polygon: Polygon;
  owner: number | undefined;
  cell: number;
}

/**
 * Cuts the land among the seeds by their Voronoi cells. With `terrain`, the borders
 * between seeds on one land are then re-cut to follow the rivers, the ridges, and the
 * coast, and to wander where none is near. Land that holds no seed joins the nearest
 * province as the straight cut has it, so an island keeps its owner.
 */
export function partition(land: MultiPolygon, seeds: Point[], terrain?: BorderTerrain): Partition {
  const seedsOf: number[][] = land.map(() => []);
  for (const [seed, point] of seeds.entries()) {
    const component = land.findIndex((polygon) => polygonContains(polygon, point));
    const members = seedsOf[component];
    if (!members) throw new Error(`seed ${seed} at ${point.join(', ')} is not on land`);
    members.push(seed);
  }

  const straight: Polygon[][] = seeds.map(() => []);
  const bent: Polygon[][] = seeds.map(() => []);
  const merges: OrphanMerge[] = [];
  const unclaimed: Polygon[] = [];
  const stitched: Polygon[] = [];
  for (const [component, polygon] of land.entries()) {
    stitched.push(polygon);
    const members = seedsOf[component] ?? [];
    const [only] = members;
    if (only === undefined) unclaimed.push(polygon);
    else if (members.length === 1) {
      straight[only]?.push(polygon);
      bent[only]?.push(polygon);
    } else {
      const straightMerges: OrphanMerge[] = [];
      const pieces = cutByVoronoi(polygon, members, seeds);
      const stranded = mergeOrphans(pieces, straightMerges);
      unclaimed.push(...stranded.map((piece) => piece.polygon));
      const owned = pieces.flatMap((piece) =>
        piece.owner === undefined ? [] : [{ owner: piece.owner, polygon: piece.polygon }],
      );
      for (const { owner, polygon: part } of owned) straight[owner]?.push(part);
      if (!terrain || stranded.length > 0) {
        merges.push(...straightMerges);
        for (const { owner, polygon: part } of owned) bent[owner]?.push(part);
        continue;
      }
      const recut = cutAlongLand(polygon, members, seeds, owned, terrain);
      stitched[component] = recut.land;
      if (mergeOrphans(recut.pieces, merges).length > 0) {
        throw new Error('a piece of the re-cut land touches no province');
      }
      for (const piece of recut.pieces) {
        if (piece.owner !== undefined) bent[piece.owner]?.push(piece.polygon);
      }
    }
  }

  const joins = joinNearest(unclaimed, straight);
  for (const join of joins) bent[join.seed]?.push(join.polygon);
  const unite = (polygons: Polygon[]) => union(...polygons.map((polygon) => [polygon]));
  return {
    land: stitched,
    territories: bent.map(unite),
    straight: straight.map(unite),
    island: seeds.map((_, seed) =>
      seedsOf.some((members) => members.length === 1 && members[0] === seed),
    ),
    merges,
    joins: joins.map(({ seed, area, distance, at }) => ({ seed, area, distance, at })),
  };
}

function cutAlongLand(
  component: Polygon,
  members: number[],
  seeds: Point[],
  territories: { owner: number; polygon: Polygon }[],
  terrain: BorderTerrain,
): { land: Polygon; pieces: Piece[] } {
  const cities = new Map(members.map((seed) => [seed, seeds[seed] as Point]));
  const { land, regions } = recut(component, territories, cities, terrain);
  const pieces = members.flatMap((seed) => {
    const parts = intersection([land], regions.get(seed) ?? []);
    const core = parts.findIndex((part) => polygonContains(part, seeds[seed] as Point));
    if (core < 0) throw new Error(`seed ${seed} lies outside its own re-cut province`);
    return parts.map((part, i) => ({
      polygon: part,
      owner: i === core ? seed : undefined,
      cell: seed,
    }));
  });
  return { land, pieces };
}

function cutByVoronoi(component: Polygon, members: number[], seeds: Point[]): Piece[] {
  const box = boxOf([component]);
  const points = members.map((seed) => seeds[seed] as Point);
  const voronoi = Delaunay.from(points).voronoi([
    box.minX - 1,
    box.minY - 1,
    box.maxX + 1,
    box.maxY + 1,
  ]);
  const pieces: Piece[] = [];
  for (const [k, seed] of members.entries()) {
    const cell = voronoi.cellPolygon(k) as Point[] | null;
    if (!cell) throw new Error(`seed ${seed} shares its position with another seed`);
    const parts = intersection([component], [[cell.slice(0, -1)]]);
    const core = parts.findIndex((part) => polygonContains(part, points[k] as Point));
    if (core < 0) throw new Error(`seed ${seed} lies outside its own Voronoi piece`);
    for (const [i, part] of parts.entries()) {
      pieces.push({ polygon: part, owner: i === core ? seed : undefined, cell: seed });
    }
  }
  return pieces;
}

function mergeOrphans(pieces: Piece[], merges: OrphanMerge[]): Piece[] {
  const { shared } = borderLengths(
    pieces.map((piece) => [piece.polygon]),
    undefined,
    TOUCH_KM,
  );
  const borders = new Map<Piece, Map<number, number>>();
  for (const [key, piece] of pieces.entries()) {
    if (piece.owner === undefined) borders.set(piece, shared[key] ?? new Map());
  }

  for (;;) {
    const decided: [Piece, number, number][] = [];
    for (const [piece, across] of borders) {
      const byOwner = new Map<number, number>();
      for (const [other, length] of across) {
        const owner = pieces[other]?.owner;
        if (owner !== undefined) byOwner.set(owner, (byOwner.get(owner) ?? 0) + length);
      }
      const best = longest(byOwner);
      if (best) decided.push([piece, ...best]);
    }
    if (decided.length === 0) break;
    for (const [piece, owner, border] of decided) {
      piece.owner = owner;
      borders.delete(piece);
      merges.push({ cell: piece.cell, seed: owner, area: area([piece.polygon]), border });
    }
  }
  return [...borders.keys()];
}

function longest(lengths: Map<number, number>): [key: number, length: number] | undefined {
  let best: [number, number] | undefined;
  for (const [key, length] of lengths) {
    if (!best || length > best[1] || (length === best[1] && key < best[0])) best = [key, length];
  }
  return best;
}

function joinNearest(
  unclaimed: Polygon[],
  territories: Polygon[][],
): (IslandJoin & { polygon: Polygon })[] {
  const targets = territories.flatMap((polygons, seed) =>
    polygons.map((polygon) => ({ seed, polygon, box: boxOf([polygon]) })),
  );
  return unclaimed.map((polygon) => {
    const box = boxOf([polygon]);
    const candidates = targets
      .map((target) => ({ ...target, gap: boxDistance(box, target.box) }))
      .sort((a, b) => a.gap - b.gap);
    let best: { seed: number; distance: number } | undefined;
    for (const candidate of candidates) {
      if (best && candidate.gap > best.distance) break;
      const d = boundaryDistance([polygon], [candidate.polygon]);
      if (!best || d < best.distance || (d === best.distance && candidate.seed < best.seed)) {
        best = { seed: candidate.seed, distance: d };
      }
    }
    if (!best) throw new Error('no territory to join');
    territories[best.seed]?.push(polygon);
    return { ...best, area: area([polygon]), at: polygon[0]?.[0] ?? [0, 0], polygon };
  });
}

export interface Relations {
  /** Sorted seed indices per seed. */
  neighbours: number[][];
  coastal: boolean[];
}

/** Measured from coinciding boundaries. Boundary on no other territory and off the extent edge is coast. */
export function relations(territories: MultiPolygon[], extent: Ring): Relations {
  const { shared, open } = borderLengths(territories, extent, TOUCH_KM);
  const neighbours = shared.map((across, a) =>
    [...territories.keys()].filter(
      (b) =>
        b !== a && Math.max(across.get(b) ?? 0, shared[b]?.get(a) ?? 0) >= NEIGHBOUR_MIN_BORDER_KM,
    ),
  );
  return { neighbours, coastal: open.map((length) => length >= COASTAL_MIN_SEA_KM) };
}

export function onExtentEdge(extent: Ring, point: Point): boolean {
  return distanceToBoundary([[extent]], point) <= ON_EXTENT_EDGE_KM;
}
