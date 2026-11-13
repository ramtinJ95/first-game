import type { GameMap, Peak, TerrainArea } from '../../sim/map.ts';
import { AreaIndex, DISTANCE_ERROR } from './area-index.ts';
import { hash01, stream, valueNoise } from './random.ts';
import { scatter, type Rect } from './scatter.ts';

export type TreeShape = 'broadleaf' | 'conifer' | 'cypress';
export type PlaceRank = 'capital' | 'city' | 'town' | 'village';
export type Crop = 'grain' | 'stubble' | 'green' | 'fallow';

/** One drawing on the land, in map km. A mountain or hill stands on its foot at `x`, `y`. */
export type Mark =
  | {
      kind: 'mountain';
      x: number;
      y: number;
      width: number;
      height: number;
      /** How high the land stands there, from 0 to 1, which sets the weight of the ink. */
      high: number;
      seed: number;
    }
  | { kind: 'hill'; x: number; y: number; width: number; height: number; seed: number }
  | { kind: 'tree'; x: number; y: number; size: number; shape: TreeShape; seed: number }
  | { kind: 'dune'; x: number; y: number; length: number; angle: number; seed: number }
  | { kind: 'stipple'; x: number; y: number; spread: number; seed: number }
  | { kind: 'field'; x: number; y: number; width: number; depth: number; angle: number; crop: Crop }
  | { kind: 'orchard'; x: number; y: number; width: number; depth: number; angle: number }
  | { kind: 'track'; points: readonly (readonly [number, number])[] }
  | { kind: 'tuft'; x: number; y: number; size: number; seed: number }
  | { kind: 'scrub'; x: number; y: number; size: number; seed: number }
  | { kind: 'rock'; x: number; y: number; size: number; seed: number }
  | { kind: 'stream'; points: readonly (readonly [number, number])[] };

/** A wood: overlapping round patches of forest ground that trees stand in. */
export interface Wood {
  readonly x: number;
  readonly y: number;
  readonly lobes: readonly { readonly x: number; readonly y: number; readonly r: number }[];
}

export interface Place {
  readonly x: number;
  readonly y: number;
  readonly rank: PlaceRank;
  readonly id: string;
}

export type Tier = 'wide' | 'middle' | 'close';

/** Spacing of each kind of drawing in km, and the side of a chunk, per tier. */
export const TIERS = {
  wide: { chunk: 2048, mountain: 34, ridge: 0, hill: 70, tree: 8.5, dune: 30, stipple: 16 },
  texture: { chunk: 256 },
  middle: { chunk: 256, mountain: 9, ridge: 24, hill: 22, tree: 4.6, dune: 13, stipple: 7 },
  close: { chunk: 64, mountain: 4.6, ridge: 13, hill: 9, tree: 1.7, dune: 5.5, stipple: 2.8 },
} as const;

/** A great power's capital, a city, a town, and a village keep this much land clear, in km. */
const CLEARING: Record<PlaceRank, number> = { capital: 7, city: 5.5, town: 2.8, village: 1.8 };
/** The ring of fields around each place, in km from its centre. */
const FIELD_RING: Record<PlaceRank, readonly [number, number]> = {
  capital: [6.5, 24],
  city: [5, 18],
  town: [2.6, 11],
  village: [1.7, 7],
};
/** The side of a field in km, from its smallest to its largest. */
const FIELD_SIZE: Record<PlaceRank, readonly [number, number]> = {
  capital: [1.6, 3.2],
  city: [1.4, 2.8],
  town: [1.1, 2.1],
  village: [0.9, 1.6],
};
const TRACK_REACH = 34;
/**
 * A river counts as a desert valley where desert lies within `desertReach` km of it,
 * and its watered strip reaches `width` km to each side. The map keeps the desert
 * about 15 km back from every river.
 */
export const VALLEY = { desertReach: 30, width: 13 } as const;
/**
 * A delta fans out from a river's end 25 to 220 km from the coast, over about 70
 * degrees. A river that ends in a lake, as the Jordan in the Dead Sea, has none.
 */
const DELTA = { inland: 25, reach: 220, spread: 0.62, lake: 10 } as const;
const WOOD_SPACING = { edge: 62, middle: 30 } as const;
/** A wood's pale rim reaches this far beyond its lobes. */
export const WOOD_RIM = 1.18;
const DEPTH_FULL = { mountains: 45, forest: 90 } as const;
const PEAK_REACH = 45;
/** How far from the coast the coast index measures, so a wood can keep off the sea. */
const COAST_REACH = 56;

/** Names of the deserts that are seas of dunes rather than stone and gravel. */
const SAND_SEA = /erg|sand sea|nafud|rub' al khali|karakum|kyzyl|registan|calanshio|libyan/i;
const MEDITERRANEAN = /mediterranean|appenine|crimean|caspian|euxine|anatolian deciduous/i;
const CONIFER = /conifer|montane|caledon|alps|pyrenees|carpathian|rodope|dinaric/i;

interface Forest {
  readonly index: AreaIndex;
  readonly name: string;
}

function kindOutlines(map: GameMap, kind: TerrainArea['kind']) {
  return map.terrain.filter((area) => area.kind === kind).map((area) => area.outline);
}

const GRID = 32;
const GRID_ROW = 4096;

function gridKey(x: number, y: number): number {
  return Math.floor(x / GRID) * GRID_ROW + Math.floor(y / GRID);
}

function inRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

/**
 * Everything a placing rule asks about the land, built once from the map: where land,
 * lakes, and each kind of terrain lie, how high the land stands, and where people live.
 */
export class Land {
  readonly land: AreaIndex;
  /** Distance to the coast or the map's frame, so a wood keeps off the sea and on the map. */
  readonly coast: AreaIndex;
  readonly lakes: AreaIndex;
  readonly mountains: AreaIndex;
  readonly hills: AreaIndex;
  readonly desert: AreaIndex;
  readonly sand: AreaIndex;
  readonly forest: AreaIndex;
  /** Distance to the rivers, so mountains leave a valley along each. */
  readonly rivers: AreaIndex;
  readonly forests: readonly Forest[];
  readonly peaks: readonly Peak[];
  readonly places: readonly Place[];
  readonly woods: readonly Wood[];
  /**
   * The stretches of river that run through desert, where the river waters a green
   * strip of fields between the sands, as the Nile, the Tigris, and the Euphrates do.
   */
  readonly valleys: readonly (readonly (readonly [number, number])[])[];
  /** Fans of watered land where a desert river ends short of the sea, as the Nile's delta. */
  readonly deltas: readonly [number, number][][];
  readonly cultivated: AreaIndex;
  readonly #valleyGrid = new Map<number, (readonly [number, number, number, number])[]>();
  readonly #placeGrid = new Map<number, Place[]>();
  readonly #woodGrid = new Map<number, Wood['lobes'][number][]>();

  constructor(map: GameMap) {
    this.land = new AreaIndex(
      map.provinces.map((p) => p.outline),
      0,
      { seams: false },
    );
    this.coast = new AreaIndex(
      [
        ...map.coastline.map((line) => [[[...line, ...line.slice(1, -1).reverse()]]]),
        [[map.extent]],
      ],
      COAST_REACH,
      { seams: false },
    );
    this.lakes = new AreaIndex(kindOutlines(map, 'lake'));
    this.mountains = new AreaIndex(kindOutlines(map, 'mountains'), DEPTH_FULL.mountains);
    this.hills = new AreaIndex(kindOutlines(map, 'hills'));
    this.desert = new AreaIndex(kindOutlines(map, 'desert'), VALLEY.desertReach);
    this.sand = new AreaIndex(
      map.terrain.filter((a) => a.kind === 'desert' && SAND_SEA.test(a.name)).map((a) => a.outline),
    );
    this.forest = new AreaIndex(kindOutlines(map, 'forest'), DEPTH_FULL.forest);
    this.rivers = new AreaIndex(
      map.rivers.map(({ line }) => [[[...line, ...line.slice(1, -1).reverse()]]]),
      16,
    );
    this.forests = map.terrain
      .filter((area) => area.kind === 'forest')
      .map((area) => ({ index: new AreaIndex([area.outline]), name: area.name }));
    this.peaks = map.peaks;
    this.places = [
      ...map.provinces.map((p) => ({
        x: p.city[0],
        y: p.city[1],
        rank: p.capital ? ('capital' as const) : ('city' as const),
        id: p.id,
      })),
      ...map.settlements.map((s) => ({ x: s.at[0], y: s.at[1], rank: s.rank, id: s.id })),
    ];
    for (const place of this.places) {
      const key = gridKey(place.x, place.y);
      const list = this.#placeGrid.get(key) ?? [];
      list.push(place);
      this.#placeGrid.set(key, list);
    }
    this.woods = this.#placeWoods(map);
    this.valleys = this.#traceValleys(map);
    for (const line of this.valleys) {
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1] as readonly [number, number];
        const [bx, by] = line[i] as readonly [number, number];
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (GRID / 2)) + 1;
        for (let n = 0; n <= steps; n++) {
          const key = gridKey(ax + ((bx - ax) * n) / steps, ay + ((by - ay) * n) / steps);
          const list = this.#valleyGrid.get(key) ?? [];
          if (!list.some(([cx, cy, dx, dy]) => cx === ax && cy === ay && dx === bx && dy === by)) {
            list.push([ax, ay, bx, by]);
          }
          this.#valleyGrid.set(key, list);
        }
      }
    }
    this.deltas = this.#traceDeltas(map);
    this.cultivated = new AreaIndex(this.deltas.map((ring) => [[ring]]));
    for (const wood of this.woods) {
      for (const lobe of wood.lobes) {
        const key = gridKey(lobe.x, lobe.y);
        const list = this.#woodGrid.get(key) ?? [];
        list.push(lobe);
        this.#woodGrid.set(key, list);
      }
    }
  }

  /** Open land: on the map's land, not in a lake. */
  open(x: number, y: number): boolean {
    return this.land.inside(x, y) && !this.lakes.inside(x, y);
  }

  /** How high the land stands, from 0 at a range's foot to 1 at its heart or a high peak. */
  height(x: number, y: number): number {
    const depth = this.mountains.depth(x, y) / DEPTH_FULL.mountains;
    let peak = 0;
    for (const p of this.peaks) {
      const d2 = (p.at[0] - x) ** 2 + (p.at[1] - y) ** 2;
      if (d2 > PEAK_REACH * PEAK_REACH * 4) continue;
      peak = Math.max(peak, Math.min(1, p.height / 4500) * Math.exp(-d2 / (2 * PEAK_REACH ** 2)));
    }
    return Math.min(1, Math.max(depth ** 0.7, peak));
  }

  placesNear(x: number, y: number, reach: number): Place[] {
    const found: Place[] = [];
    const r = Math.ceil(reach / GRID);
    const cx = Math.floor(x / GRID);
    const cy = Math.floor(y / GRID);
    for (let j = cy - r; j <= cy + r; j++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (const place of this.#placeGrid.get(i * GRID_ROW + j) ?? []) {
          if ((place.x - x) ** 2 + (place.y - y) ** 2 <= reach * reach) found.push(place);
        }
      }
    }
    return found;
  }

  /** Whether the spot lies in the clearing a place keeps, for places shown at this tier. */
  cleared(x: number, y: number, tier: Tier): boolean {
    if (tier === 'wide') return false;
    return this.placesNear(x, y, CLEARING.capital).some((place) => {
      if (tier === 'middle' && (place.rank === 'village' || place.rank === 'town')) return false;
      const r = CLEARING[place.rank] * (tier === 'middle' ? 1.6 : 1);
      return (place.x - x) ** 2 + (place.y - y) ** 2 < r * r;
    });
  }

  /**
   * How deep inside a wood the spot is, from 0 outside to 1 at a lobe's centre, with
   * each lobe widened by `spread` so a margin around the wood counts too.
   */
  woodDepth(x: number, y: number, spread = 1): number {
    let best = 0;
    const cx = Math.floor(x / GRID);
    const cy = Math.floor(y / GRID);
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const lobe of this.#woodGrid.get(i * GRID_ROW + j) ?? []) {
          const d = Math.hypot(lobe.x - x, lobe.y - y);
          const r = lobe.r * spread;
          if (d < r) best = Math.max(best, 1 - d / r);
        }
      }
    }
    return best;
  }

  treeShape(x: number, y: number, seed: number): TreeShape {
    const forest = this.forests.find(({ index }) => {
      const b = index.bounds;
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom && index.inside(x, y);
    });
    const name = forest?.name ?? '';
    if (MEDITERRANEAN.test(name)) return seed < 0.45 ? 'cypress' : 'broadleaf';
    if (CONIFER.test(name)) return seed < 0.8 ? 'conifer' : 'broadleaf';
    if (/mixed/i.test(name)) return seed < 0.45 ? 'conifer' : 'broadleaf';
    return seed < 0.12 ? 'conifer' : 'broadleaf';
  }

  /** The nearest watered valley within its width: how far, and which way the river runs. */
  valleyAt(x: number, y: number): { distance: number; angle: number } | undefined {
    let best: { distance: number; angle: number } | undefined;
    const cx = Math.floor(x / GRID);
    const cy = Math.floor(y / GRID);
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const [ax, ay, bx, by] of this.#valleyGrid.get(i * GRID_ROW + j) ?? []) {
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
          );
          const distance = Math.hypot(ax + t * dx - x, ay + t * dy - y);
          if (distance < VALLEY.width && (!best || distance < best.distance)) {
            best = { distance, angle: Math.atan2(dy, dx) };
          }
        }
      }
    }
    return best;
  }

  #traceValleys(map: GameMap): [number, number][][] {
    const runs: [number, number][][] = [];
    for (const { line } of map.rivers) {
      let run: [number, number][] = [];
      for (const [x, y] of line) {
        if (this.desert.distance(x, y) < VALLEY.desertReach) run.push([x, y]);
        else {
          if (run.length > 1) runs.push(run);
          run = [];
        }
      }
      if (run.length > 1) runs.push(run);
    }
    return runs;
  }

  /**
   * A valley whose river ends inland, short of the coast, fans out to the coast ahead
   * of it. The fan runs from the river's end to the coastline points within
   * `DELTA.spread` of the way the river runs there, in order round the end.
   */
  #traceDeltas(map: GameMap): [number, number][][] {
    const coast = map.coastline.flat();
    const deltas: [number, number][][] = [];
    for (const { line } of map.rivers) {
      const end = line[line.length - 1];
      if (!end || this.desert.distance(end[0], end[1]) >= VALLEY.desertReach) continue;
      const inLake = (a: number) =>
        this.lakes.inside(end[0] + Math.cos(a) * DELTA.lake, end[1] + Math.sin(a) * DELTA.lake);
      if ([0, 1, 2, 3, 4, 5, 6, 7].some((n) => inLake((n / 8) * Math.PI * 2))) continue;
      const before = line[Math.max(0, line.length - 6)] ?? end;
      const toward = Math.atan2(end[1] - before[1], end[0] - before[0]);
      let nearest = Infinity;
      for (const [x, y] of coast) {
        const angle = Math.atan2(y - end[1], x - end[0]);
        if (Math.abs(Math.atan2(Math.sin(angle - toward), Math.cos(angle - toward))) > DELTA.spread)
          continue;
        nearest = Math.min(nearest, Math.hypot(x - end[0], y - end[1]));
      }
      if (nearest < DELTA.inland || nearest > DELTA.reach) continue;
      const fan = coast
        .map(([x, y]) => {
          const angle = Math.atan2(y - end[1], x - end[0]);
          const off = Math.atan2(Math.sin(angle - toward), Math.cos(angle - toward));
          return { x, y, off, d: Math.hypot(x - end[0], y - end[1]) };
        })
        .filter((p) => Math.abs(p.off) < DELTA.spread && p.d < nearest * 1.5)
        .sort((a, b) => a.off - b.off);
      if (fan.length < 3) continue;
      deltas.push([[end[0], end[1]], ...fan.map((p): [number, number] => [p.x, p.y])]);
    }
    return deltas;
  }

  #placeWoods(map: GameMap): Wood[] {
    const rect = { left: 0, top: 0, right: map.width, bottom: map.height };
    const points = scatter(
      rect,
      16,
      901,
      (x, y) => {
        if (!this.forest.inside(x, y) || !this.open(x, y) || this.mountains.inside(x, y)) {
          return undefined;
        }
        if (valueNoise(x, y, 140, 902) < 0.3) return undefined;
        const depth = this.forest.depth(x, y) / DEPTH_FULL.forest;
        return WOOD_SPACING.edge + (WOOD_SPACING.middle - WOOD_SPACING.edge) * depth;
      },
      WOOD_SPACING.edge,
    );
    return points.flatMap(({ x, y, radius, seed }) => {
      const random = stream(seed);
      const size = radius * (0.42 + 0.14 * random());
      const lobes = [{ x, y, r: size }];
      const count = 3 + Math.floor(random() * 4);
      for (let n = 0; n < count; n++) {
        const angle = random() * Math.PI * 2;
        const distance = size * (0.55 + 0.5 * random());
        const lx = x + Math.cos(angle) * distance;
        const ly = y + Math.sin(angle) * distance;
        if (!this.open(lx, ly)) continue;
        lobes.push({ x: lx, y: ly, r: size * (0.45 + 0.4 * random()) });
      }
      const clear = lobes
        .map((lobe) => ({
          ...lobe,
          r: Math.min(
            lobe.r,
            this.mountains.distance(lobe.x, lobe.y) - 2,
            (this.coast.distance(lobe.x, lobe.y) - DISTANCE_ERROR) / WOOD_RIM - 1,
          ),
        }))
        .filter((lobe) => lobe.r > size * 0.25 && !this.mountains.inside(lobe.x, lobe.y));
      return clear.length > 0 ? [{ x, y, lobes: clear }] : [];
    });
  }
}

/**
 * How strongly a spot lies on a ridge, from 0 in a valley to 1 on a crest. Ridges run
 * parallel to a range's outline, one every `wavelength` km of depth, and wander with
 * noise, so a range shows chains of peaks with valleys between them.
 */
function ridge(land: Land, x: number, y: number, wavelength: number, salt: number): number {
  const depth = land.mountains.depth(x, y);
  const phase = depth / wavelength - 0.5 + (valueNoise(x, y, wavelength * 3, salt) - 0.5) * 1.1;
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);
}

function relief(land: Land, rect: Rect, tier: Tier, salt: number): Mark[] {
  const spacing = TIERS[tier];
  const marks: Mark[] = [];
  const nearPeak = (x: number, y: number, reach: number) =>
    tier !== 'wide' &&
    land.peaks.some((p) => (p.at[0] - x) ** 2 + (p.at[1] - y) ** 2 < reach * reach);
  for (const { x, y, radius, seed } of scatter(
    rect,
    spacing.mountain / 2.2,
    salt,
    (x, y) => {
      if (!land.mountains.inside(x, y) || !land.open(x, y) || land.cleared(x, y, tier)) {
        return undefined;
      }
      if (nearPeak(x, y, spacing.mountain * 1.3)) return undefined;
      if (tier !== 'wide' && land.rivers.distance(x, y) < spacing.mountain * 0.9) return undefined;
      const high = land.height(x, y);
      const deep = land.mountains.depth(x, y) > spacing.ridge * 0.5;
      if (
        spacing.ridge > 0 &&
        deep &&
        ridge(land, x, y, spacing.ridge, salt + 5) < 0.66 - 0.4 * high
      ) {
        return undefined;
      }
      if (high < 0.15 && hash01(Math.floor(x * 7), Math.floor(y * 7), salt + 6) < 0.5)
        return undefined;
      return spacing.mountain * (1.25 - 0.5 * high);
    },
    spacing.mountain * 1.25,
  )) {
    const high = land.height(x, y);
    const random = stream(seed);
    const grow = tier === 'wide' ? 1.25 : 0.95;
    const width = spacing.mountain * (grow + 1.25 * high) * (0.8 + 0.4 * random());
    const height = width * (0.42 + 0.3 * high + 0.1 * random());
    marks.push({ kind: 'mountain', x, y, width: Math.max(width, radius), height, high, seed });
  }
  for (const { x, y, radius, seed } of scatter(
    rect,
    spacing.hill / 2.2,
    salt + 10,
    (x, y) => {
      if (!land.hills.inside(x, y) || !land.open(x, y)) return undefined;
      if (land.mountains.distance(x, y) < spacing.hill * 0.5 || land.mountains.inside(x, y)) {
        return undefined;
      }
      if (land.cleared(x, y, tier) || valueNoise(x, y, 70, salt + 11) < 0.48) return undefined;
      return spacing.hill * (0.9 + 0.5 * hash01(Math.floor(x), Math.floor(y), salt + 12));
    },
    spacing.hill * 1.4,
  )) {
    const width = radius * (0.75 + 0.35 * stream(seed)());
    marks.push({ kind: 'hill', x, y, width, height: width * 0.26, seed });
  }
  return marks;
}

function trees(land: Land, rect: Rect, tier: Tier, salt: number): Mark[] {
  const spacing = TIERS[tier].tree;
  return scatter(
    rect,
    spacing / 2,
    salt + 20,
    (x, y) => {
      if (!land.forest.inside(x, y)) return undefined;
      const depth = land.woodDepth(x, y);
      const loose = depth === 0;
      if (loose && land.woodDepth(x, y, 1.6) === 0) return undefined;
      if (!land.open(x, y) || land.mountains.inside(x, y) || land.cleared(x, y, tier)) {
        return undefined;
      }
      if (tier !== 'wide' && inFields(land, x, y, FARMED_SHARE)) return undefined;
      if (loose && valueNoise(x, y, 25, salt + 21) < 0.5) return undefined;
      return spacing * (loose ? 2.2 : 1.25 - 0.4 * depth);
    },
    spacing * 2.2,
  ).map(({ x, y, radius, seed }) => ({
    kind: 'tree',
    x,
    y,
    size: Math.min(radius, spacing * 1.2) * (1.05 + 0.3 * stream(seed)()),
    shape: land.treeShape(x, y, stream(seed + 0.5)()),
    seed,
  }));
}

/** The wind that shapes the dunes blows from the north-east over the whole map. */
const DUNE_ANGLE = -0.35;

function desert(land: Land, rect: Rect, tier: Tier, salt: number): Mark[] {
  const { dune, stipple } = TIERS[tier];
  const marks: Mark[] = [];
  for (const { x, y, radius, seed } of scatter(
    rect,
    dune / 2,
    salt + 30,
    (x, y) => {
      if (!land.desert.inside(x, y) || !land.open(x, y) || land.cleared(x, y, tier))
        return undefined;
      const sand = land.sand.inside(x, y);
      const field = valueNoise(x, y, 60, salt + 31);
      if (field < (sand ? 0.3 : 0.62)) return undefined;
      return dune * (sand ? 1.6 - field : 1.5);
    },
    dune * 1.5,
  )) {
    const random = stream(seed);
    const angle =
      DUNE_ANGLE + (valueNoise(x, y, 200, salt + 32) - 0.5) * 0.6 + (random() - 0.5) * 0.25;
    marks.push({ kind: 'dune', x, y, length: radius * (0.7 + 0.8 * random()), angle, seed });
  }
  for (const { x, y, radius, seed } of scatter(
    rect,
    stipple / 2,
    salt + 40,
    (x, y) => {
      if (!land.desert.inside(x, y) || !land.open(x, y) || land.cleared(x, y, tier))
        return undefined;
      if (valueNoise(x, y, 45, salt + 41) < 0.35) return undefined;
      return stipple;
    },
    stipple,
  )) {
    marks.push({ kind: 'stipple', x, y, spread: radius * 0.45, seed });
  }
  return marks;
}

function onOpenLand(land: Land, x: number, y: number): boolean {
  return land.open(x, y) && !land.mountains.inside(x, y);
}

const CROPS: readonly Crop[] = ['grain', 'grain', 'stubble', 'green', 'fallow'];

/** The spacing of the plots along a desert river and across its delta, in km. */
const VALLEY_FIELD = 1.5;

const VALLEY_CROPS: readonly Crop[] = ['green', 'green', 'grain', 'grain', 'stubble'];

/**
 * Strips of field along a desert river and across its delta, laid across the river's
 * way like the plots of the Nile, with a few palm groves among them.
 */
function valleyFields(land: Land, rect: Rect): Mark[] {
  const marks: Mark[] = [];
  for (const { x, y, seed } of scatter(
    rect,
    VALLEY_FIELD / 2,
    707,
    (x, y) => {
      if (!land.open(x, y) || land.desert.inside(x, y) || land.cleared(x, y, 'close'))
        return undefined;
      const valley = land.valleyAt(x, y);
      if (!valley && !land.cultivated.inside(x, y)) return undefined;
      return VALLEY_FIELD;
    },
    VALLEY_FIELD,
  )) {
    const random = stream(seed);
    const valley = land.valleyAt(x, y);
    const angle = (valley?.angle ?? 0.4) + Math.PI / 2 + (random() - 0.5) * 0.2;
    const width = 1.5 + random() * 1.0;
    const depth = 0.8 + random() * 0.4;
    if (random() < 0.16) marks.push({ kind: 'orchard', x, y, width, depth: depth * 1.4, angle });
    else {
      const crop = VALLEY_CROPS[Math.floor(random() * VALLEY_CROPS.length)] ?? 'green';
      marks.push({ kind: 'field', x, y, width, depth, angle, crop });
    }
  }
  return marks;
}

function fields(land: Land, rect: Rect): Mark[] {
  const marks: Mark[] = [];
  const places = land
    .placesNear(
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
      Math.hypot(rect.right - rect.left, rect.bottom - rect.top) / 2 + 1,
    )
    .filter((place) => inRect(rect, place.x, place.y))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const place of places) {
    const random = stream(hash01(Math.round(place.x * 10), Math.round(place.y * 10), 77));
    const [inner, outer] = FIELD_RING[place.rank];
    const grain = random() * Math.PI;
    const desert = land.desert.inside(place.x, place.y);
    const [small, large] = FIELD_SIZE[place.rank];
    const size = (small + large) / 2;
    const c = Math.cos(grain);
    const s = Math.sin(grain);
    const reach = Math.ceil(outer / (size * 0.55)) + 1;
    for (let v = -reach; v <= reach; v++) {
      const rowDepth = size * (0.42 + 0.2 * hash01(v, 0, Math.floor(random() * 1e6)));
      let u = -outer;
      while (u < outer) {
        const width = small + (large - small) * random();
        const cu = u + width / 2;
        const cv = v * size * 0.62;
        u += width;
        const x = place.x + cu * c - cv * s;
        const y = place.y + cu * s + cv * c;
        const distance = Math.hypot(x - place.x, y - place.y);
        const edge = outer * (0.75 + 0.35 * valueNoise(x, y, outer * 0.6, 79));
        if (distance < inner || distance > edge) continue;
        if (random() < (desert ? 0.55 : 0.12) + 0.5 * ((distance - inner) / (edge - inner)) ** 2)
          continue;
        if (!onOpenLand(land, x, y)) continue;
        const near = land
          .placesNear(x, y, 6)
          .some(
            (other) =>
              other !== place && Math.hypot(other.x - x, other.y - y) < CLEARING[other.rank],
          );
        if (near) continue;
        const depth = Math.min(rowDepth, size * 0.6);
        if (random() < (desert ? 0.3 : 0.1)) {
          marks.push({
            kind: 'orchard',
            x,
            y,
            width: width * 0.9,
            depth: depth * 0.9,
            angle: grain,
          });
        } else {
          const crop = CROPS[Math.floor(random() * CROPS.length)] ?? 'grain';
          marks.push({
            kind: 'field',
            x,
            y,
            width: width * 0.94,
            depth: depth * 0.9,
            angle: grain,
            crop,
          });
        }
      }
    }
    for (const other of nearestPlaces(land, place)) {
      // A pair where each is among the other's nearest is drawn once, from the lower id.
      if (other.id < place.id && nearestPlaces(land, other).includes(place)) continue;
      const track = trackBetween(land, place, other);
      if (track) marks.push(track);
    }
  }
  marks.push(...valleyFields(land, rect));
  return marks;
}

/** The two places nearest `place` within a track's reach, which its tracks lead to. */
function nearestPlaces(land: Land, place: Place): Place[] {
  const distance = (other: Place) => Math.hypot(other.x - place.x, other.y - place.y);
  return land
    .placesNear(place.x, place.y, TRACK_REACH)
    .filter((other) => other !== place)
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, 2);
}

function trackBetween(land: Land, from: Place, to: Place): Mark | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const random = stream(
    hash01(Math.round(from.x * 10 + to.x * 10), Math.round(from.y * 10 + to.y * 10), 78),
  );
  const bend = (random() - 0.5) * length * 0.25;
  const points: [number, number][] = [];
  const steps = Math.max(4, Math.ceil(length / 1.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const sway = Math.sin(t * Math.PI) * bend + Math.sin(t * Math.PI * 3 + random()) * 0.25;
    const x = from.x + dx * t - (dy / length) * sway;
    const y = from.y + dy * t + (dx / length) * sway;
    if (!land.open(x, y)) return undefined;
    points.push([x, y]);
  }
  const trimmed = points.filter(([x, y]) => {
    const near = (p: Place) => Math.hypot(p.x - x, p.y - y) < CLEARING[p.rank] * 0.7;
    return !near(from) && !near(to);
  });
  return trimmed.length >= 2 ? { kind: 'track', points: trimmed } : undefined;
}

/**
 * Open land away from the fields still shows its ground at the closest zoom: clumps of
 * grass tufts and scrub, rocks near the hills and mountains and on the dry land, and
 * here and there a stream. Each spot is seeded from its place, like every mark.
 */
const GROUND = { spacing: 2.4, clump: 16, stream: 26, streamStep: 0.7, streamSteps: 14 } as const;

function inFields(land: Land, x: number, y: number, share = 0.85): boolean {
  return land
    .placesNear(x, y, FIELD_RING.capital[1])
    .some((place) => Math.hypot(place.x - x, place.y - y) < FIELD_RING[place.rank][1] * share);
}

/** Trees keep off the inner fields of each place, so the land round it reads as farmed. */
const FARMED_SHARE = 0.6;

function openGround(land: Land, x: number, y: number): boolean {
  return (
    onOpenLand(land, x, y) &&
    land.woodDepth(x, y, 1.2) === 0 &&
    !land.cultivated.inside(x, y) &&
    !land.valleyAt(x, y)
  );
}

function ground(land: Land, rect: Rect): Mark[] {
  const marks: Mark[] = [];
  for (const { x, y, seed } of scatter(
    rect,
    GROUND.spacing / 2,
    808,
    (x, y) => {
      if (valueNoise(x, y, GROUND.clump, 809) < 0.42) return undefined;
      if (!openGround(land, x, y) || land.cleared(x, y, 'close') || inFields(land, x, y))
        return undefined;
      return GROUND.spacing;
    },
    GROUND.spacing,
  )) {
    const random = stream(seed);
    const dry = land.desert.inside(x, y);
    const rugged = land.hills.inside(x, y) || land.mountains.distance(x, y) < 20;
    const roll = random();
    const kind: 'tuft' | 'scrub' | 'rock' = dry
      ? roll < 0.55
        ? 'rock'
        : 'scrub'
      : rugged
        ? roll < 0.4
          ? 'rock'
          : roll < 0.75
            ? 'scrub'
            : 'tuft'
        : roll < 0.6
          ? 'tuft'
          : roll < 0.92
            ? 'scrub'
            : 'rock';
    marks.push({ kind, x, y, size: 0.8 + random() * 0.6, seed });
  }
  for (const { x, y, seed } of scatter(
    rect,
    GROUND.stream / 2,
    810,
    (x, y) =>
      openGround(land, x, y) && !land.desert.inside(x, y) && !inFields(land, x, y)
        ? GROUND.stream
        : undefined,
    GROUND.stream,
  )) {
    const random = stream(seed);
    let heading = random() * Math.PI * 2;
    const points: [number, number][] = [[x, y]];
    let at: [number, number] = [x, y];
    for (let n = 0; n < GROUND.streamSteps; n++) {
      heading += (random() - 0.5) * 0.9;
      const next: [number, number] = [
        at[0] + Math.cos(heading) * GROUND.streamStep,
        at[1] + Math.sin(heading) * GROUND.streamStep,
      ];
      if (!openGround(land, next[0], next[1])) break;
      points.push(next);
      at = next;
    }
    if (points.length >= 6) marks.push({ kind: 'stream', points });
  }
  return marks;
}

/**
 * The relief, trees, and desert marks of one tier whose foot lies in `rect`, drawn from
 * the back (north) to the front. The same rect, tier, and map give the same marks every
 * time, and neighbouring rects never place the same mark twice.
 */
export function placeRelief(land: Land, rect: Rect, tier: Tier): Mark[] {
  const salt = tier === 'wide' ? 100 : tier === 'middle' ? 200 : 300;
  const marks = [
    ...relief(land, rect, tier, salt),
    ...(tier === 'wide'
      ? []
      : [...trees(land, rect, tier, salt), ...desert(land, rect, tier, salt)]),
  ];
  return marks.sort((a, b) => footOf(a) - footOf(b));
}

/**
 * The small tree marks, dunes, and stipple of the regional zoom, which give the woods
 * and the deserts a texture once the whole map no longer fills the view.
 */
export function placeTexture(land: Land, rect: Rect): Mark[] {
  return [...trees(land, rect, 'wide', 150), ...desert(land, rect, 'wide', 150)].sort(
    (a, b) => footOf(a) - footOf(b),
  );
}

/** The fields, orchards, and tracks of the places that stand in `rect`. */
export function placeFields(land: Land, rect: Rect): Mark[] {
  return [...ground(land, rect), ...fields(land, rect)].sort((a, b) => footOf(a) - footOf(b));
}

function footOf(mark: Mark): number {
  return 'points' in mark ? -Infinity : mark.y;
}

/** The named peaks whose foot lies in `rect`. */
export function peaksIn(land: Land, rect: Rect): Peak[] {
  return land.peaks.filter((peak) => inRect(rect, peak.at[0], peak.at[1]));
}
