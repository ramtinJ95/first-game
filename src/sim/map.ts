import * as v from 'valibot';
import { ProvinceIdSchema, type ProvinceId } from './ids.ts';

export const POWERS = ['rome', 'carthage', 'macedon', 'egypt', 'persia'] as const;
export type PowerId = (typeof POWERS)[number];

const StartingOwnerSchema = v.picklist(
  [...POWERS, 'independent'],
  (issue) => `unknown owner ${String(issue.input)}`,
);
export type StartingOwner = v.InferOutput<typeof StartingOwnerSchema>;

export function isStartingOwner(value: unknown): value is StartingOwner {
  return v.is(StartingOwnerSchema, value);
}

export const MAP_VERSION = 2;

const FiniteSchema = v.pipe(
  v.number('expected a finite number'),
  v.finite('expected a finite number'),
);
const PositiveSchema = v.pipe(FiniteSchema, v.gtValue(0, 'expected a positive number'));
const NameSchema = v.pipe(v.string('expected a string'), v.nonEmpty('expected a name'));
const IntegerSchema = v.pipe(v.number('expected a number'), v.integer('expected an integer'));

/** Map plane coordinates in km: x grows east, y grows south, origin at the top-left corner. */
const PointSchema = v.strictTuple([FiniteSchema, FiniteSchema], 'expected a point [x, y]');

/** A closed ring stored without repeating its first point. */
const RingSchema = v.pipe(
  v.array(PointSchema, 'expected an array'),
  v.minLength(3, (issue) => `expected at least 3 points, got ${issue.received}`),
);

/** The first ring is the outer ring, the rest are holes. */
const PolygonSchema = v.pipe(
  v.array(RingSchema, 'expected an array'),
  v.nonEmpty('expected at least one entry'),
);

const MultiPolygonSchema = v.pipe(
  v.array(PolygonSchema, 'expected an array'),
  v.nonEmpty('expected at least one entry'),
);

/** An open polyline. A closed loop repeats its first point at the end. */
const MapLineSchema = v.pipe(
  v.array(PointSchema, 'expected an array'),
  v.minLength(2, (issue) => `expected at least 2 points, got ${issue.received}`),
);

const ProjectionSchema = v.object({
  kind: v.literal('albers-equal-area-conic', "expected 'albers-equal-area-conic'"),
  /** Sphere radius in km. */
  radius: PositiveSchema,
  lon0: FiniteSchema,
  lat0: FiniteSchema,
  parallels: v.strictTuple([FiniteSchema, FiniteSchema], 'expected two latitudes'),
  /** Projected coordinates (km, y grows north) of the map's top-left corner. */
  origin: PointSchema,
});

const MapProvinceIdSchema = v.pipe(
  ProvinceIdSchema,
  v.regex(/^[a-z][a-z0-9-]*$/, (issue) => `expected a kebab-case id, got ${String(issue.input)}`),
);

const ProvinceSchema = v.object({
  id: MapProvinceIdSchema,
  name: v.string('expected a string'),
  pleiadesId: IntegerSchema,
  owner: StartingOwnerSchema,
  capital: v.boolean('expected a boolean'),
  port: v.boolean('expected a boolean'),
  coastal: v.boolean('expected a boolean'),
  island: v.boolean('expected a boolean'),
  city: PointSchema,
  /** km². */
  area: PositiveSchema,
  neighbours: v.array(ProvinceIdSchema, 'expected an array'),
  outline: MultiPolygonSchema,
});

const RiverSchema = v.object({ name: v.string('expected a string'), line: MapLineSchema });

export const TERRAIN_KINDS = ['mountains', 'hills', 'desert', 'forest', 'lake'] as const;

/**
 * At most one area per kind and name. Areas of one kind overlap only in slivers left by rounding
 * vertices to 0.1 km. Areas of different kinds may overlap, as a forested mountain is both. `name`
 * is empty where the source names none.
 */
const TerrainAreaSchema = v.object({
  kind: v.picklist(TERRAIN_KINDS, (issue) => `unknown terrain kind ${String(issue.input)}`),
  name: v.string('expected a string'),
  outline: MultiPolygonSchema,
});

const PeakSchema = v.object({
  name: NameSchema,
  /** Metres above sea level. */
  height: IntegerSchema,
  at: PointSchema,
});

/** `s-<pleiadesId>`. */
const SettlementIdSchema = v.pipe(
  v.string('expected a string'),
  v.regex(/^s-[0-9]+$/, (issue) => `expected an id s-<pleiadesId>, got ${String(issue.input)}`),
  v.brand('SettlementId'),
);

/** A named ancient place between the cities. It has no people and no rules yet. */
const SettlementSchema = v.object({
  id: SettlementIdSchema,
  name: NameSchema,
  pleiadesId: IntegerSchema,
  at: PointSchema,
  province: ProvinceIdSchema,
  rank: v.picklist(['town', 'village'], (issue) => `unknown rank ${String(issue.input)}`),
});

/** Static map data, built by `npm run build:map`. It is not part of the game state. */
const GameMapSchema = v.object({
  version: v.literal(MAP_VERSION, `expected ${MAP_VERSION}`),
  unit: v.literal('km', "expected 'km'"),
  projection: ProjectionSchema,
  width: PositiveSchema,
  height: PositiveSchema,
  extent: RingSchema,
  provinces: v.array(ProvinceSchema, 'expected an array'),
  coastline: v.array(MapLineSchema, 'expected an array'),
  rivers: v.array(RiverSchema, 'expected an array'),
  terrain: v.array(TerrainAreaSchema, 'expected an array'),
  peaks: v.array(PeakSchema, 'expected an array'),
  settlements: v.array(SettlementSchema, 'expected an array'),
});

export type Point = v.InferOutput<typeof PointSchema>;
export type Ring = v.InferOutput<typeof RingSchema>;
export type Polygon = v.InferOutput<typeof PolygonSchema>;
export type MultiPolygon = v.InferOutput<typeof MultiPolygonSchema>;
export type MapLine = v.InferOutput<typeof MapLineSchema>;
export type Projection = v.InferOutput<typeof ProjectionSchema>;
export type Province = v.InferOutput<typeof ProvinceSchema>;
export type River = v.InferOutput<typeof RiverSchema>;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];
export type TerrainArea = v.InferOutput<typeof TerrainAreaSchema>;
export type Peak = v.InferOutput<typeof PeakSchema>;
export type SettlementId = v.InferOutput<typeof SettlementIdSchema>;
export type Settlement = v.InferOutput<typeof SettlementSchema>;
export type GameMap = v.InferOutput<typeof GameMapSchema>;

export function parseMap(raw: unknown): GameMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('', 'expected an object');
  const parsed = v.safeParse(GameMapSchema, raw);
  if (!parsed.success) {
    const [issue] = parsed.issues;
    fail(pathOf(issue), issue.message);
  }
  const map = parsed.output;
  const ids = new Set<ProvinceId>();
  for (const [i, { id }] of map.provinces.entries()) {
    if (ids.has(id)) fail(`.provinces[${i}].id`, `duplicate id ${id}`);
    ids.add(id);
  }
  for (const [i, { id, neighbours }] of map.provinces.entries()) {
    for (const [j, neighbour] of neighbours.entries()) {
      const path = `.provinces[${i}].neighbours[${j}]`;
      if (!ids.has(neighbour)) fail(path, `unknown province ${neighbour}`);
      if (neighbour === id) fail(path, 'a province cannot neighbour itself');
    }
  }
  const settlements = new Set<SettlementId>();
  for (const [i, { id, province }] of map.settlements.entries()) {
    if (settlements.has(id)) fail(`.settlements[${i}].id`, `duplicate id ${id}`);
    settlements.add(id);
    if (!ids.has(province)) fail(`.settlements[${i}].province`, `unknown province ${province}`);
  }
  return map;
}

function pathOf(issue: v.BaseIssue<unknown>): string {
  return (issue.path ?? [])
    .map(({ key }) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`))
    .join('');
}

function fail(path: string, why: string): never {
  throw new Error(`map${path}: ${why}`);
}
