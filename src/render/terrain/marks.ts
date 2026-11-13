import type { GameMap, Peak, TerrainArea } from '../../sim/map.ts';
import { AreaIndex, DISTANCE_ERROR } from './area-index.ts';
import { hash01, stream, valueNoise } from './random.ts';
import { scatter, type Rect } from './scatter.ts';

export type TreeShape = 'broadleaf' | 'conifer' | 'cypress';
export type PlaceRank = 'capital' | 'city' | 'town' | 'village' | 'hamlet';
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
  | {
      /** A long bare ridge of a dry range seen from above, centred on `x`, `y` and running along `angle`. */
      kind: 'fold';
      x: number;
      y: number;
      length: number;
      width: number;
      angle: number;
      high: number;
      seed: number;
    }
  | { kind: 'hill'; x: number; y: number; width: number; height: number; seed: number }
  | { kind: 'tree'; x: number; y: number; size: number; shape: TreeShape; seed: number }
  | { kind: 'dune'; x: number; y: number; length: number; angle: number; seed: number }
  | { kind: 'stipple'; x: number; y: number; spread: number; seed: number }
  /** One polygon of the cracked crust of a salt pan. */
  | { kind: 'crack'; x: number; y: number; size: number; seed: number }
  | { kind: 'field'; x: number; y: number; width: number; depth: number; angle: number; crop: Crop }
  | { kind: 'orchard'; x: number; y: number; width: number; depth: number; angle: number }
  | { kind: 'track'; points: readonly (readonly [number, number])[] }
  /** An unnamed hamlet's houses, centred on `x`, `y`. */
  | { kind: 'hamlet'; x: number; y: number; roofs: Hamlet['roofs']; seed: number }
  /** The mounds round the shafts of a qanat, one at each point. */
  | { kind: 'qanat'; points: readonly (readonly [number, number])[] }
  | {
      kind: 'tuft';
      x: number;
      y: number;
      size: number;
      seed: number;
      /** Green grass on the land of the forest biomes, straw-coloured on the dry land. */
      tone: 'green' | 'straw';
    }
  /** A burial mound. */
  | { kind: 'tumulus'; x: number; y: number; size: number; seed: number }
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

/** An unnamed hamlet of the dry land, drawn with the fields, and the qanat that waters it. */
export interface Hamlet extends Place {
  readonly rank: 'hamlet';
  /** Flat roofs of mud brick on arid land, pitched roofs elsewhere. */
  readonly roofs: 'flat' | 'pitched';
  /** The qanat's shafts from the mother well at the range's foot down to the hamlet. */
  readonly qanat: readonly (readonly [number, number])[] | undefined;
  readonly seed: number;
}

export type Tier = 'wide' | 'middle' | 'close';

/** Spacing of each kind of drawing in km, and the side of a chunk, per tier. */
export const TIERS = {
  wide: {
    chunk: 2048,
    mountain: 34,
    ridge: 0,
    fold: 0,
    hill: 70,
    tree: 8.5,
    dune: 30,
    stipple: 16,
  },
  texture: { chunk: 256 },
  middle: {
    chunk: 256,
    mountain: 9,
    ridge: 24,
    fold: 26,
    hill: 22,
    tree: 4.6,
    dune: 13,
    stipple: 7,
  },
  close: {
    chunk: 64,
    mountain: 4.6,
    ridge: 13,
    fold: 12,
    hill: 9,
    tree: 1.7,
    dune: 5.5,
    stipple: 2.8,
  },
} as const;
/** A named peak raises the land this much or more where a dry range still stands as peaks. */
const FOLD_PEAK_LIFT = 0.8;
/** A fold's spacing and width, each as a share of its length. */
const FOLD = { spacing: 0.6, width: 0.26 } as const;

/**
 * A great power's capital, a city, a town, a village, and a hamlet keep this much land
 * clear, in km.
 */
const CLEARING: Record<PlaceRank, number> = {
  capital: 7,
  city: 5.5,
  town: 2.8,
  village: 1.8,
  hamlet: 2.4,
};
/** The ring of fields around each place, in km from its centre. */
const FIELD_RING: Record<PlaceRank, readonly [number, number]> = {
  capital: [6.5, 24],
  city: [5, 18],
  town: [2.6, 11],
  village: [1.7, 7],
  hamlet: [2.3, 5.2],
};
/** The side of a field in km, from its smallest to its largest. */
const FIELD_SIZE: Record<PlaceRank, readonly [number, number]> = {
  capital: [1.6, 3.2],
  city: [1.4, 2.8],
  town: [1.1, 2.1],
  village: [0.9, 1.6],
  hamlet: [0.8, 1.3],
};
/**
 * The dry land's unnamed hamlets, where people lived by water: by a river, or at the
 * foot of a range, which on arid land a qanat brings down to them, its shafts
 * `qanat.shaft` km apart from a mother well up to `qanat.reach` km away. They are sought
 * on tiles of `tile` km, `spacing` km apart.
 */
const HAMLET = {
  tile: 64,
  spacing: 17,
  riverKm: 4.5,
  footKm: 16,
  qanat: { reach: 22, shortest: 5, shaft: 1.15, step: 1.2, directions: 16 },
} as const;
const TRACK_REACH = 34;
/**
 * A river counts as a desert valley where desert lies within `desertReach` km of it,
 * and its watered strip reaches `width` km to each side. The map keeps the desert
 * about 15 km back from every river.
 */
export const VALLEY = { desertReach: 30, width: 13 } as const;
/**
 * A delta fans out from a river's end 25 to 220 km from the coast, over about 70
 * degrees. A river that ends in a lake, as the Jordan in the Dead Sea, has none. Its
 * sides swell and waver (`deltaSide`), drawn in steps of `step` km.
 */
const DELTA = {
  inland: 25,
  reach: 220,
  spread: 0.62,
  lake: 10,
  bulge: 0.08,
  waver: 7,
  waverCell: 28,
  step: 4,
} as const;
const WOOD_SPACING = { edge: 62, middle: 30 } as const;
/** A wood's pale rim reaches this far beyond its lobes. */
export const WOOD_RIM = 1.18;
const DEPTH_FULL = { mountains: 45, forest: 90 } as const;
const PEAK_REACH = 45;
/** How far from the coast the coast index measures, so a wood can keep off the sea. */
const COAST_REACH = 56;

/**
 * What grows on open land. The map's forests are the temperate forest biomes, so land
 * outside every forest area is dry: steppe and Mediterranean grass and scrub. Dry land
 * within `desertKm` of a desert, or more than `forestKm` from every forest and `coastKm`
 * from the sea, is arid semi-desert, as the Persian plateau, Mesopotamia, and the edge of
 * the Sahara are. Each limit blends over `blendKm`.
 */
export type Cover = 'green' | 'dry' | 'arid';
export const ARID = { desertKm: 250, forestKm: 500, coastKm: 40, blendKm: 80 } as const;
/** Dry land reaches its full colour this far from the nearest forest. */
const DRY_BLEND_KM = 60;
const COVER_CELL = 4;
const COVERS: readonly (Cover | undefined)[] = [undefined, 'green', 'dry', 'arid'];

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Names of the deserts that are seas of dunes rather than stone and gravel. */
const SAND_SEA = /erg|sand sea|nafud|rub' al khali|karakum|kyzyl|registan|calanshio|libyan/i;
/** Names of the deserts that are salt flats: a kavir is a salt desert in Persian. */
const SALT_FLAT = /kavir/i;
/** The salt pans' spacing in km, and the depth into the salt desert where they are densest. */
const PAN = { spacing: 34, depthFull: 60 } as const;
/** A pan's pale rim reaches this far beyond its lobes. */
export const PAN_RIM = 1.15;
/**
 * The mountain index measures depth this far into a range, so the way a range runs can
 * be read deep inside a wide range such as the Zagros. `strike` reads the depth on a
 * lattice of `step` km, `reach` steps to each side of a spot.
 */
const STRIKE_REACH = 160;
const STRIKE = { step: 45, reach: 2 } as const;
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
 * A delta fan's side from the river's end to a coast point, without its two ends: it
 * swells out from the fan by DELTA.bulge of its length and wavers by up to DELTA.waver
 * km, so the fan's sides are a silted plain's edge and not two ruled lines.
 */
function deltaSide(
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  toward: number,
): [number, number][] {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  let nx = -dy / length;
  let ny = dx / length;
  if (nx * Math.cos(toward) + ny * Math.sin(toward) > 0) {
    nx = -nx;
    ny = -ny;
  }
  const steps = Math.ceil(length / DELTA.step);
  const side: [number, number][] = [];
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = ax + dx * t;
    const y = ay + dy * t;
    const waver = DELTA.waver * (2 * valueNoise(x, y, DELTA.waverCell, 71) - 1);
    const out = Math.sin(Math.PI * t) * (DELTA.bulge * length + waver);
    side.push([x + nx * out, y + ny * out]);
  }
  return side;
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
  /** The salt deserts, and the pans of white crust that lie in them. */
  readonly salt: AreaIndex;
  readonly pans: readonly Wood[];
  readonly #valleyGrid: SegmentGrid = new Map();
  readonly #riverGrid: SegmentGrid = new Map();
  readonly #placeGrid = new Map<number, Place[]>();
  readonly #woodGrid = new Map<number, Wood['lobes'][number][]>();
  readonly #panGrid = new Map<number, Wood['lobes'][number][]>();
  readonly #coverColumns: number;
  /** Each cell's cover once asked: 0 not yet, then 1, 2, 3 for the entries of `COVERS`. */
  readonly #covers: Uint8Array;
  /** The hamlets of each tile once asked. */
  readonly #hamlets = new Map<number, readonly Hamlet[]>();

  constructor(map: GameMap) {
    this.#coverColumns = Math.ceil(map.width / COVER_CELL);
    this.#covers = new Uint8Array(this.#coverColumns * Math.ceil(map.height / COVER_CELL));
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
    this.mountains = new AreaIndex(kindOutlines(map, 'mountains'), STRIKE_REACH);
    this.hills = new AreaIndex(kindOutlines(map, 'hills'));
    this.desert = new AreaIndex(kindOutlines(map, 'desert'), ARID.desertKm);
    this.sand = new AreaIndex(
      map.terrain.filter((a) => a.kind === 'desert' && SAND_SEA.test(a.name)).map((a) => a.outline),
    );
    this.salt = new AreaIndex(
      map.terrain
        .filter((a) => a.kind === 'desert' && SALT_FLAT.test(a.name))
        .map((a) => a.outline),
      PAN.depthFull,
    );
    this.forest = new AreaIndex(kindOutlines(map, 'forest'), ARID.forestKm);
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
    indexSegments(this.valleys, this.#valleyGrid);
    indexSegments(
      map.rivers.map((river) => river.line),
      this.#riverGrid,
    );
    this.deltas = this.#traceDeltas(map);
    this.cultivated = new AreaIndex(this.deltas.map((ring) => [[ring]]));
    indexLobes(this.woods, this.#woodGrid);
    this.pans = this.#placePans();
    indexLobes(this.pans, this.#panGrid);
  }

  /** Open land: on the map's land, not in a lake. */
  open(x: number, y: number): boolean {
    return this.land.inside(x, y) && !this.lakes.inside(x, y);
  }

  /**
   * How dry the land is, from 0 in a forest area to 1, and how arid, from 0 to 1, each
   * blending over the distances `ARID` names.
   */
  dryness(x: number, y: number): { dry: number; arid: number } {
    if (this.forest.inside(x, y)) return { dry: 0, arid: 0 };
    const fromForest = this.forest.distance(x, y);
    const nearDesert = this.desert.inside(x, y)
      ? 1
      : 1 - smoothstep(ARID.desertKm - ARID.blendKm, ARID.desertKm, this.desert.distance(x, y));
    const inland =
      smoothstep(ARID.forestKm - ARID.blendKm, ARID.forestKm, fromForest) *
      smoothstep(ARID.coastKm / 2, ARID.coastKm, this.coast.distance(x, y));
    return { dry: smoothstep(0, DRY_BLEND_KM, fromForest), arid: Math.max(nearDesert, inland) };
  }

  /**
   * What grows at a spot, read from its cell of `COVER_CELL` km, which is worked out from
   * the cell's centre the first time it is asked. Placing a mark asks for thousands of
   * spots, and the forest's outline is costly to test near its edge.
   */
  cover(x: number, y: number): Cover {
    const i = Math.floor(x / COVER_CELL);
    const j = Math.floor(y / COVER_CELL);
    if (
      i < 0 ||
      j < 0 ||
      i >= this.#coverColumns ||
      j * this.#coverColumns >= this.#covers.length
    ) {
      return 'green';
    }
    const k = j * this.#coverColumns + i;
    let known = this.#covers[k] ?? 0;
    if (known === 0) {
      const cx = (i + 0.5) * COVER_CELL;
      const cy = (j + 0.5) * COVER_CELL;
      known = this.forest.inside(cx, cy) ? 1 : this.dryness(cx, cy).arid >= 0.5 ? 3 : 2;
      this.#covers[k] = known;
    }
    return COVERS[known] ?? 'green';
  }

  /**
   * The way a range runs at a spot, in radians: across the way its depth rises, taken
   * over the land `STRIKE.reach` steps round the spot, so a range's folds run one way
   * across its width and do not curl round each basin inside it. Rising depth on the two
   * flanks points opposite ways, so each is counted by its doubled angle.
   */
  strike(x: number, y: number): number {
    const d = STRIKE.step / 2;
    let c = 0;
    let s = 0;
    for (let j = -STRIKE.reach; j <= STRIKE.reach; j++) {
      for (let i = -STRIKE.reach; i <= STRIKE.reach; i++) {
        const px = x + i * STRIKE.step;
        const py = y + j * STRIKE.step;
        const gx = this.mountains.smoothDepth(px + d, py) - this.mountains.smoothDepth(px - d, py);
        const gy = this.mountains.smoothDepth(px, py + d) - this.mountains.smoothDepth(px, py - d);
        c += gx * gx - gy * gy;
        s += 2 * gx * gy;
      }
    }
    return Math.atan2(s, c) / 2 + Math.PI / 2;
  }

  /** The nearest river within `reach` km: how far, and which way it runs. */
  riverAt(x: number, y: number, reach: number): { distance: number; angle: number } | undefined {
    return nearestSegment(this.#riverGrid, x, y, reach);
  }

  /**
   * How deep inside a salt pan the spot is, from 0 outside to 1 at a pan's centre, with
   * each lobe widened by `spread` so its rim counts too.
   */
  panDepth(x: number, y: number, spread = 1): number {
    return lobeDepth(this.#panGrid, x, y, spread);
  }

  /** How high the land stands, from 0 at a range's foot to 1 at its heart or a high peak. */
  height(x: number, y: number): number {
    const depth = this.mountains.depth(x, y) / DEPTH_FULL.mountains;
    return Math.min(1, Math.max(depth ** 0.7, this.peakLift(x, y)));
  }

  /** How much a high named peak nearby raises the land, from 0 to 1. */
  peakLift(x: number, y: number): number {
    let peak = 0;
    for (const p of this.peaks) {
      const d2 = (p.at[0] - x) ** 2 + (p.at[1] - y) ** 2;
      if (d2 > PEAK_REACH * PEAK_REACH * 4) continue;
      peak = Math.max(peak, Math.min(1, p.height / 4500) * Math.exp(-d2 / (2 * PEAK_REACH ** 2)));
    }
    return peak;
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

  /**
   * Whether the spot lies in the clearing a place keeps, for places shown at this tier,
   * hamlets at the close tier included unless `hamlets` is false.
   */
  cleared(x: number, y: number, tier: Tier, hamlets = true): boolean {
    if (tier === 'wide') return false;
    const byPlace = this.placesNear(x, y, CLEARING.capital).some((place) => {
      if (tier === 'middle' && (place.rank === 'village' || place.rank === 'town')) return false;
      const r = CLEARING[place.rank] * (tier === 'middle' ? 1.6 : 1);
      return (place.x - x) ** 2 + (place.y - y) ** 2 < r * r;
    });
    if (byPlace || !hamlets || tier !== 'close') return byPlace;
    return this.hamletsNear(x, y, CLEARING.hamlet).length > 0;
  }

  /** The hamlets within `reach` km, at most a tile's side. */
  hamletsNear(x: number, y: number, reach: number): Hamlet[] {
    const found: Hamlet[] = [];
    const size = HAMLET.tile;
    for (let j = Math.floor((y - reach) / size); j <= Math.floor((y + reach) / size); j++) {
      for (let i = Math.floor((x - reach) / size); i <= Math.floor((x + reach) / size); i++) {
        for (const h of this.#hamletTile(i, j)) {
          if ((h.x - x) ** 2 + (h.y - y) ** 2 < reach * reach) found.push(h);
        }
      }
    }
    return found;
  }

  #hamletTile(i: number, j: number): readonly Hamlet[] {
    if (i < 0 || j < 0) return [];
    const key = i * GRID_ROW + j;
    let tile = this.#hamlets.get(key);
    if (!tile) {
      const size = HAMLET.tile;
      tile = placeHamlets(this, {
        left: i * size,
        top: j * size,
        right: (i + 1) * size,
        bottom: (j + 1) * size,
      });
      this.#hamlets.set(key, tile);
    }
    return tile;
  }

  /**
   * How deep inside a wood the spot is, from 0 outside to 1 at a lobe's centre, with
   * each lobe widened by `spread` so a margin around the wood counts too.
   */
  woodDepth(x: number, y: number, spread = 1): number {
    return lobeDepth(this.#woodGrid, x, y, spread);
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
    return nearestSegment(this.#valleyGrid, x, y, VALLEY.width);
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
      const first = fan[0] as { x: number; y: number };
      const last = fan[fan.length - 1] as { x: number; y: number };
      deltas.push([
        [end[0], end[1]],
        ...deltaSide(end, [first.x, first.y], toward),
        ...fan.map((p): [number, number] => [p.x, p.y]),
        ...deltaSide(end, [last.x, last.y], toward).reverse(),
      ]);
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
        const depth = Math.min(1, this.forest.depth(x, y) / DEPTH_FULL.forest);
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

  /**
   * Pans of salt crust over the salt deserts, larger and closer together deeper in, with
   * stony desert between them, as the crust of the Dasht-e Kavir lies.
   */
  #placePans(): Wood[] {
    const b = this.salt.bounds;
    if (b.right <= b.left) return [];
    const rect = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    return scatter(
      rect,
      PAN.spacing / 2,
      903,
      (x, y) => {
        if (!this.salt.inside(x, y) || !this.open(x, y)) return undefined;
        if (valueNoise(x, y, PAN.spacing * 3, 904) < 0.25) return undefined;
        return PAN.spacing * (1.3 - 0.5 * Math.min(1, this.salt.depth(x, y) / PAN.depthFull));
      },
      PAN.spacing * 1.3,
    ).flatMap(({ x, y, radius, seed }) => {
      const random = stream(seed);
      const size = radius * (0.5 + 0.2 * random());
      const lobes = [{ x, y, r: size }];
      for (let n = 0; n < 4; n++) {
        const angle = random() * Math.PI * 2;
        const distance = size * (0.5 + 0.5 * random());
        const lx = x + Math.cos(angle) * distance;
        const ly = y + Math.sin(angle) * distance;
        lobes.push({ x: lx, y: ly, r: size * (0.4 + 0.35 * random()) });
      }
      const kept = lobes
        .map((lobe) => ({
          ...lobe,
          r: Math.min(lobe.r, (this.salt.depth(lobe.x, lobe.y) - DISTANCE_ERROR) / PAN_RIM - 1),
        }))
        .filter((lobe) => lobe.r > size * 0.25 && this.open(lobe.x, lobe.y));
      return kept.length > 0 ? [{ x, y, lobes: kept }] : [];
    });
  }
}

type SegmentGrid = Map<number, (readonly [number, number, number, number])[]>;

function indexSegments(
  lines: readonly (readonly (readonly [number, number])[])[],
  grid: SegmentGrid,
) {
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1] as readonly [number, number];
      const [bx, by] = line[i] as readonly [number, number];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (GRID / 2)) + 1;
      for (let n = 0; n <= steps; n++) {
        const key = gridKey(ax + ((bx - ax) * n) / steps, ay + ((by - ay) * n) / steps);
        const list = grid.get(key) ?? [];
        if (!list.some(([cx, cy, dx, dy]) => cx === ax && cy === ay && dx === bx && dy === by)) {
          list.push([ax, ay, bx, by]);
        }
        grid.set(key, list);
      }
    }
  }
}

/** The nearest segment of the grid within `reach`, which must be under a grid cell. */
function nearestSegment(
  grid: SegmentGrid,
  x: number,
  y: number,
  reach: number,
): { distance: number; angle: number } | undefined {
  let best: { distance: number; angle: number } | undefined;
  const cx = Math.floor(x / GRID);
  const cy = Math.floor(y / GRID);
  for (let j = cy - 1; j <= cy + 1; j++) {
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (const [ax, ay, bx, by] of grid.get(i * GRID_ROW + j) ?? []) {
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(
          0,
          Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
        );
        const distance = Math.hypot(ax + t * dx - x, ay + t * dy - y);
        if (distance < reach && (!best || distance < best.distance)) {
          best = { distance, angle: Math.atan2(dy, dx) };
        }
      }
    }
  }
  return best;
}

type LobeGrid = Map<number, Wood['lobes'][number][]>;

function indexLobes(woods: readonly Wood[], grid: LobeGrid) {
  for (const wood of woods) {
    for (const lobe of wood.lobes) {
      const key = gridKey(lobe.x, lobe.y);
      const list = grid.get(key) ?? [];
      list.push(lobe);
      grid.set(key, list);
    }
  }
}

function lobeDepth(grid: LobeGrid, x: number, y: number, spread: number): number {
  let best = 0;
  const cx = Math.floor(x / GRID);
  const cy = Math.floor(y / GRID);
  for (let j = cy - 1; j <= cy + 1; j++) {
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (const lobe of grid.get(i * GRID_ROW + j) ?? []) {
        const d = Math.hypot(lobe.x - x, lobe.y - y);
        const r = lobe.r * spread;
        if (d < r) best = Math.max(best, 1 - d / r);
      }
    }
  }
  return best;
}

/**
 * How strongly a spot lies on a ridge, from 0 in a valley to 1 on a crest. Ridges run
 * parallel to a range's outline, one every `wavelength` km of depth, and wander with
 * noise, so a range shows chains of peaks with valleys between them.
 */
function ridge(land: Land, x: number, y: number, wavelength: number, salt: number): number {
  const depth = Math.min(DEPTH_FULL.mountains, land.mountains.depth(x, y));
  const phase = depth / wavelength - 0.5 + (valueNoise(x, y, wavelength * 3, salt) - 0.5) * 1.1;
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);
}

/**
 * A range outside the forests is drawn as long bare folds, as the Zagros and the Atlas
 * are, except round a high named peak, from the middle zoom in.
 */
function folded(land: Land, x: number, y: number, tier: Tier): boolean {
  return tier !== 'wide' && land.cover(x, y) !== 'green' && land.peakLift(x, y) < FOLD_PEAK_LIFT;
}

/**
 * The folds of the dry ranges, each along the way its range runs and kept about half a
 * fold's length from the next, so they stand side by side across the range with valleys
 * between them and overlap end to end along it.
 */
function folds(
  land: Land,
  rect: Rect,
  tier: Tier,
  salt: number,
  nearPeak: (x: number, y: number) => boolean,
): Mark[] {
  const { fold: length, mountain } = TIERS[tier];
  const spacing = length * FOLD.spacing;
  return scatter(
    rect,
    spacing / 2.2,
    salt + 50,
    (x, y) => {
      if (!land.mountains.inside(x, y) || !land.open(x, y) || land.cleared(x, y, tier)) {
        return undefined;
      }
      if (!folded(land, x, y, tier) || nearPeak(x, y)) return undefined;
      if (tier === 'close' && land.hamletsNear(x, y, length * 0.6).length > 0) return undefined;
      if (land.rivers.distance(x, y) < mountain * 0.9) return undefined;
      return spacing * (1.15 - 0.3 * land.height(x, y));
    },
    spacing * 1.15,
  ).flatMap(({ x, y, seed }): Mark[] => {
    const random = stream(seed);
    const high = land.height(x, y);
    const size = length * (0.75 + 0.5 * random()) * (0.85 + 0.3 * high);
    const angle = land.strike(x, y) + (random() - 0.5) * 0.22;
    const width = size * (FOLD.width + 0.08 * random());
    const fold = { kind: 'fold', x, y, length: size, width, angle, high, seed } as const;
    return foldOutline(fold).every(([px, py]) => land.open(px, py)) ? [fold] : [];
  });
}

/**
 * Points round the most a fold's oval can cover, its bow included, so a fold on a range by
 * the coast is dropped when its centre is on land and its end or flank is not.
 */
export function foldOutline(m: Extract<Mark, { kind: 'fold' }>): [number, number][] {
  const dx = Math.cos(m.angle);
  const dy = Math.sin(m.angle);
  return [
    [0.5, 0],
    [0.25, 0.75],
    [0, 0.9],
    [-0.25, 0.75],
    [-0.5, 0],
    [-0.25, -0.75],
    [0, -0.9],
    [0.25, -0.75],
  ].map(([along = 0, across = 0]) => {
    const u = along * m.length;
    const v = across * m.width;
    return [m.x + dx * u - dy * v, m.y + dy * u + dx * v];
  });
}

function relief(land: Land, rect: Rect, tier: Tier, salt: number): Mark[] {
  const spacing = TIERS[tier];
  const marks: Mark[] = [];
  const nearPeak = (x: number, y: number, reach: number) =>
    tier !== 'wide' &&
    land.peaks.some((p) => (p.at[0] - x) ** 2 + (p.at[1] - y) ** 2 < reach * reach);
  if (tier !== 'wide' && dryIn(land, rect)) {
    marks.push(...folds(land, rect, tier, salt, (x, y) => nearPeak(x, y, spacing.mountain * 1.3)));
  }
  for (const { x, y, radius, seed } of scatter(
    rect,
    spacing.mountain / 2.2,
    salt,
    (x, y) => {
      if (!land.mountains.inside(x, y) || !land.open(x, y) || land.cleared(x, y, tier)) {
        return undefined;
      }
      if (nearPeak(x, y, spacing.mountain * 1.3) || folded(land, x, y, tier)) return undefined;
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

/** The salt crust's polygons, the cells of its cracks, are this wide in km at each tier. */
const CRACK: Record<Tier, number> = { wide: 0, middle: 4.2, close: 1.8 };

function desert(land: Land, rect: Rect, tier: Tier, salt: number): Mark[] {
  const { dune, stipple } = TIERS[tier];
  const marks: Mark[] = [];
  const bare = (x: number, y: number) =>
    land.desert.inside(x, y) &&
    land.open(x, y) &&
    !land.cleared(x, y, tier) &&
    land.panDepth(x, y, PAN_RIM) === 0;
  for (const { x, y, radius, seed } of scatter(
    rect,
    dune / 2,
    salt + 30,
    (x, y) => {
      if (!bare(x, y)) return undefined;
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
      if (!bare(x, y)) return undefined;
      if (valueNoise(x, y, 45, salt + 41) < 0.35) return undefined;
      return stipple;
    },
    stipple,
  )) {
    marks.push({ kind: 'stipple', x, y, spread: radius * 0.45, seed });
  }
  const crack = CRACK[tier];
  if (crack > 0) {
    for (const { x, y, seed } of scatter(
      rect,
      crack / 2,
      salt + 45,
      (x, y) => (land.panDepth(x, y) > 0.08 && land.open(x, y) ? crack : undefined),
      crack,
    )) {
      marks.push({ kind: 'crack', x, y, size: crack * 0.55, seed });
    }
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
  const centre = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  const radius = Math.hypot(rect.right - rect.left, rect.bottom - rect.top) / 2 + 1;
  const places: (Place | Hamlet)[] = [
    ...land.placesNear(centre.x, centre.y, radius),
    ...land.hamletsNear(centre.x, centre.y, radius),
  ]
    .filter((place) => inRect(rect, place.x, place.y))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const place of places) {
    const random = stream(hash01(Math.round(place.x * 10), Math.round(place.y * 10), 77));
    const [inner, outer] = FIELD_RING[place.rank];
    const grain = random() * Math.PI;
    const oasis = 'roofs' in place && place.roofs === 'flat';
    const desert = land.desert.inside(place.x, place.y) || oasis;
    if ('roofs' in place) {
      marks.push({ kind: 'hamlet', x: place.x, y: place.y, roofs: place.roofs, seed: place.seed });
      if (place.qanat) marks.push({ kind: 'qanat', points: place.qanat });
    }
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
        const thin = oasis ? 0.2 : desert ? 0.55 : 0.12;
        if (random() < thin + 0.5 * ((distance - inner) / (edge - inner)) ** 2) continue;
        if (place.rank === 'hamlet' ? !land.open(x, y) : !onOpenLand(land, x, y)) continue;
        const near = land
          .placesNear(x, y, 6)
          .some(
            (other) =>
              other !== place && Math.hypot(other.x - x, other.y - y) < CLEARING[other.rank],
          );
        if (near) continue;
        const depth = Math.min(rowDepth, size * 0.6);
        if (random() < (oasis ? 0.45 : desert ? 0.3 : 0.1)) {
          marks.push({
            kind: 'orchard',
            x,
            y,
            width: width * 0.9,
            depth: depth * 0.9,
            angle: grain,
          });
        } else {
          const crops = oasis ? VALLEY_CROPS : CROPS;
          const crop = crops[Math.floor(random() * crops.length)] ?? 'grain';
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
      if (other.id < place.id && nearestPlaces(land, other).some((p) => p.id === place.id)) {
        continue;
      }
      const track = trackBetween(land, place, other);
      if (track) marks.push(track);
    }
  }
  marks.push(...valleyFields(land, rect));
  return marks;
}

/**
 * The two places nearest `place` within a track's reach, which its tracks lead to. A
 * hamlet's tracks lead to hamlets too, so the hamlets of a dry plain are joined by tracks
 * where it has no named place; a named place's tracks lead only to named places.
 */
function nearestPlaces(land: Land, place: Place): Place[] {
  const distance = (other: Place) => Math.hypot(other.x - place.x, other.y - place.y);
  return [
    ...land.placesNear(place.x, place.y, TRACK_REACH),
    ...(place.rank === 'hamlet' ? land.hamletsNear(place.x, place.y, TRACK_REACH) : []),
  ]
    .filter((other) => other.id !== place.id)
    .sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : 1))
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
 * here and there a stream. Land outside the forests shows its ground from the middle
 * zoom, with larger marks further apart, and burial mounds stand on its plains. Each
 * spot is seeded from its place, like every mark.
 */
const GROUND = { spacing: 2.4, clump: 16, stream: 26, streamStep: 0.7, streamSteps: 14 } as const;
const MIDDLE_GROUND = { spacing: 5.2, clump: 34, size: [1.9, 1.1] } as const;
/**
 * The shares of tufts and bushes on each kind of open ground, the rest being rocks: the
 * desert, the arid land, rough ground near hills and mountains, the dry land, and the
 * green land of the forest biomes.
 */
type Ground = 'desert' | 'arid' | 'rugged' | 'dry' | 'green';
const GROUND_MIX: Record<Ground, readonly [tuft: number, scrub: number]> = {
  desert: [0, 0.45],
  arid: [0.16, 0.36],
  rugged: [0.25, 0.35],
  dry: [0.52, 0.3],
  green: [0.6, 0.32],
};
/**
 * Burial mounds stand in groups on the plains of the dry land, as the kurgans of the
 * steppe and the tumuli of Thrace, Phrygia, and Lydia do: `spacing` km apart where a
 * group stands, `size` km across, per tier.
 */
const TUMULUS: Record<'middle' | 'close', { spacing: number; size: number }> = {
  middle: { spacing: 9, size: 3.4 },
  close: { spacing: 3.6, size: 1.6 },
};
/** Trees line the rivers of the dry land within this many km of the water, per tier. */
const GALLERY_KM: Record<'middle' | 'close', number> = { middle: 3.2, close: 1.6 };

/**
 * Whether any land outside the forests lies in `rect`, from a lattice of spots
 * `DRY_SAMPLE_KM` apart, so the marks only the dry land has are not sought where the
 * whole rect is green. A dry patch narrower than the lattice may go without them.
 */
const DRY_SAMPLE_KM = 10;
function dryIn(land: Land, rect: Rect): boolean {
  for (let y = rect.top; y <= rect.bottom; y += DRY_SAMPLE_KM) {
    for (let x = rect.left; x <= rect.right; x += DRY_SAMPLE_KM) {
      if (land.cover(x, y) !== 'green' && land.land.inside(x, y)) return true;
    }
  }
  return false;
}

function groundOf(land: Land, x: number, y: number): Ground {
  if (land.desert.inside(x, y)) return 'desert';
  const cover = land.cover(x, y);
  if (cover === 'arid') return 'arid';
  if (land.hills.inside(x, y) || land.mountains.distance(x, y) < 20) return 'rugged';
  return cover;
}

function groundKind(ground: Ground, roll: number): 'tuft' | 'scrub' | 'rock' {
  const [tuft, scrub] = GROUND_MIX[ground];
  return ground === 'desert'
    ? roll < 1 - scrub
      ? 'rock'
      : 'scrub'
    : ground === 'rugged'
      ? roll < 1 - tuft - scrub
        ? 'rock'
        : roll < 1 - tuft
          ? 'scrub'
          : 'tuft'
      : roll < tuft
        ? 'tuft'
        : roll < tuft + scrub
          ? 'scrub'
          : 'rock';
}

/** Whether the spot lies in a share of the ring of fields of a place, or of a hamlet unless `hamlets` is false. */
function inFields(land: Land, x: number, y: number, share = 0.85, hamlets = true): boolean {
  const byPlace = land
    .placesNear(x, y, FIELD_RING.capital[1])
    .some((place) => Math.hypot(place.x - x, place.y - y) < FIELD_RING[place.rank][1] * share);
  if (byPlace || !hamlets) return byPlace;
  return land.hamletsNear(x, y, FIELD_RING.hamlet[1] * share).length > 0;
}

/**
 * The hamlets of a tile: spots on dry land outside the woods and the fields of every
 * place, by a river or near the edge of a range, in the valleys between a dry range's
 * folds too, which keep clear of them. One on arid land below a range with no river at
 * hand gets a qanat from the nearest foot of the range, if one lies within its reach.
 */
function placeHamlets(land: Land, rect: Rect): Hamlet[] {
  return scatter(
    rect,
    HAMLET.spacing / 2.5,
    870,
    (x, y) => {
      if (land.cover(x, y) === 'green' || land.desert.inside(x, y)) return undefined;
      if (valueNoise(x, y, 90, 872) < 0.28) return undefined;
      if (!land.open(x, y) || land.woodDepth(x, y, 1.2) > 0 || land.valleyAt(x, y))
        return undefined;
      if (land.cultivated.inside(x, y) || land.panDepth(x, y, PAN_RIM) > 0) return undefined;
      if (land.cleared(x, y, 'close', false) || inFields(land, x, y, 1.2, false)) return undefined;
      const watered =
        land.riverAt(x, y, HAMLET.riverKm) !== undefined ||
        land.mountains.distance(x, y) < HAMLET.footKm ||
        land.hills.inside(x, y);
      return watered ? HAMLET.spacing : undefined;
    },
    HAMLET.spacing,
  ).flatMap(({ x, y, seed }): Hamlet[] => {
    if (!footOnLand(land, x, y, CLEARING.hamlet)) return [];
    const arid = land.cover(x, y) === 'arid';
    const river = land.riverAt(x, y, HAMLET.riverKm);
    return [
      {
        x,
        y,
        rank: 'hamlet',
        id: `hamlet-${Math.round(x * 10)}-${Math.round(y * 10)}`,
        roofs: arid ? 'flat' : 'pitched',
        qanat: arid && !river ? qanatTo(land, x, y) : undefined,
        seed,
      },
    ];
  });
}

/**
 * The shafts of a qanat to a hamlet at `x`, `y`: from the nearest foot of a range, found
 * by walking out in each of `HAMLET.qanat.directions` ways, down in a line to the
 * hamlet's edge. A line that would cross a lake, the sea, a range, or a place's
 * clearing is not dug.
 */
function qanatTo(land: Land, x: number, y: number): [number, number][] | undefined {
  const { reach, shortest, shaft, step, directions } = HAMLET.qanat;
  let best: { distance: number; angle: number } | undefined;
  for (let n = 0; n < directions; n++) {
    const angle = (n / directions) * Math.PI * 2;
    for (let d = shortest; d <= reach && (!best || d < best.distance); d += step) {
      if (land.mountains.inside(x + Math.cos(angle) * d, y + Math.sin(angle) * d)) {
        best = { distance: d, angle };
        break;
      }
    }
  }
  if (!best) return undefined;
  const shafts: [number, number][] = [];
  const dx = Math.cos(best.angle);
  const dy = Math.sin(best.angle);
  const bend = (hash01(Math.round(x * 10), Math.round(y * 10), 871) - 0.5) * 0.25;
  for (let d = best.distance - step; d > CLEARING.hamlet; d -= shaft) {
    const sway = Math.sin((d / best.distance) * Math.PI) * bend * d;
    const sx = x + dx * d - dy * sway;
    const sy = y + dy * d + dx * sway;
    if (!land.open(sx, sy) || land.mountains.inside(sx, sy)) return undefined;
    if (land.cleared(sx, sy, 'close', false)) return undefined;
    shafts.push([sx, sy]);
  }
  return shafts.length >= 4 ? shafts : undefined;
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

/** The drawing reaches its size to each side and above its foot, so all of it keeps to land, as on a coast. */
function footOnLand(land: Land, x: number, y: number, size: number): boolean {
  const footprint: [number, number][] = [
    [x - size, y],
    [x + size, y],
    [x, y - size],
    [x - size * 0.7, y - size * 0.7],
    [x + size * 0.7, y - size * 0.7],
  ];
  return footprint.every(([fx, fy]) => land.open(fx, fy));
}

function ground(land: Land, rect: Rect, tier: 'middle' | 'close'): Mark[] {
  const marks: Mark[] = [];
  const close = tier === 'close';
  const dry = dryIn(land, rect);
  if (!close && !dry) return marks;
  const spacing = close ? GROUND.spacing : MIDDLE_GROUND.spacing;
  for (const { x, y, seed } of scatter(
    rect,
    spacing / 2,
    close ? 808 : 818,
    (x, y) => {
      if (valueNoise(x, y, close ? GROUND.clump : MIDDLE_GROUND.clump, 809) < 0.42)
        return undefined;
      if (!close && (land.cover(x, y) === 'green' || land.desert.inside(x, y))) return undefined;
      if (land.panDepth(x, y, PAN_RIM) > 0) return undefined;
      if (!openGround(land, x, y) || land.cleared(x, y, tier) || inFields(land, x, y))
        return undefined;
      return spacing;
    },
    spacing,
  )) {
    const random = stream(seed);
    const here = groundOf(land, x, y);
    const kind = groundKind(here, random());
    const [small, spread] = close ? [0.8, 0.6] : MIDDLE_GROUND.size;
    const size = small + random() * spread;
    if (!footOnLand(land, x, y, size)) continue;
    if (kind === 'tuft') {
      marks.push({ kind, x, y, size, seed, tone: here === 'green' ? 'green' : 'straw' });
    } else marks.push({ kind, x, y, size, seed });
  }
  if (dry) marks.push(...tumuli(land, rect, tier), ...gallery(land, rect, tier));
  if (!close) return marks;
  for (const { x, y, seed } of scatter(
    rect,
    GROUND.stream / 2,
    810,
    (x, y) => {
      if (!openGround(land, x, y) || land.desert.inside(x, y) || inFields(land, x, y)) {
        return undefined;
      }
      const cover = land.cover(x, y);
      if (cover === 'arid' || (cover === 'dry' && hash01(Math.floor(x), Math.floor(y), 811) < 0.5))
        return undefined;
      return GROUND.stream;
    },
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

function tumuli(land: Land, rect: Rect, tier: 'middle' | 'close'): Mark[] {
  const { spacing, size } = TUMULUS[tier];
  return scatter(
    rect,
    spacing / 2,
    tier === 'close' ? 820 : 830,
    (x, y) => {
      if (valueNoise(x, y, 70, 821) < 0.66) return undefined;
      if (land.hills.inside(x, y) || land.desert.inside(x, y) || land.cover(x, y) !== 'dry') {
        return undefined;
      }
      if (!openGround(land, x, y) || land.cleared(x, y, tier) || inFields(land, x, y, 0.5)) {
        return undefined;
      }
      return spacing;
    },
    spacing,
  ).flatMap(({ x, y, seed }): Mark[] => {
    const grown = size * (0.7 + 0.6 * stream(seed)());
    return footOnLand(land, x, y, grown) ? [{ kind: 'tumulus', x, y, size: grown, seed }] : [];
  });
}

/** Rows of trees along the rivers of the dry and arid land, where the water keeps them. */
function gallery(land: Land, rect: Rect, tier: 'middle' | 'close'): Mark[] {
  const spacing = TIERS[tier].tree * 1.4;
  const reach = GALLERY_KM[tier];
  return scatter(
    rect,
    spacing / 2,
    tier === 'close' ? 840 : 850,
    (x, y) => {
      const river = land.riverAt(x, y, reach);
      if (!river || river.distance < reach * 0.25) return undefined;
      if (valueNoise(x, y, 14, 851) < 0.3) return undefined;
      if (land.cover(x, y) === 'green' || land.desert.inside(x, y)) return undefined;
      if (!openGround(land, x, y) || land.cleared(x, y, tier)) return undefined;
      if (inFields(land, x, y, FARMED_SHARE)) return undefined;
      return spacing;
    },
    spacing,
  ).flatMap(({ x, y, seed }): Mark[] => {
    const random = stream(seed);
    const size = TIERS[tier].tree * (1.05 + 0.3 * random());
    if (!footOnLand(land, x, y, size * 0.6)) return [];
    const shape: TreeShape =
      land.cover(x, y) === 'arid' || random() < 0.3 ? 'cypress' : 'broadleaf';
    return [{ kind: 'tree', x, y, size, shape, seed }];
  });
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
    // The ground goes with the relief, whose chunks already hold drawings, so it adds no
    // chunk to build and fade in where the land had none.
    ...(tier === 'wide' ? [] : ground(land, rect, tier)),
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
  return fields(land, rect).sort((a, b) => footOf(a) - footOf(b));
}

function footOf(mark: Mark): number {
  return 'points' in mark ? -Infinity : mark.y;
}

/** The named peaks whose foot lies in `rect`. */
export function peaksIn(land: Land, rect: Rect): Peak[] {
  return land.peaks.filter((peak) => inRect(rect, peak.at[0], peak.at[1]));
}
