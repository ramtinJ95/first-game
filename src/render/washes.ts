import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { GameMap, MultiPolygon } from '../sim/map.ts';

/** The side of a cell of the wash in km. */
export const WASH_CELL_KM = 4;
/**
 * A wash is clear this many km from the border of another owner and full this far in,
 * so no owner's colour ends at a hard edge and the border's ink line carries the border.
 */
export const WASH_FADE_KM = { clear: 3, full: 30 } as const;
/**
 * A wash is laid this many times as strong over the desert, whose yellow ground would
 * otherwise swallow the colour, so each power's hue holds on the sand as on the paper.
 */
export const WASH_DESERT_GAIN = 1.45;
/**
 * The gain rises over twice this many km across a desert's edge, as the desert's share of
 * the land this far round each cell. The deserts' outlines run in long straight lines,
 * and a gain that switched on at the outline drew them in the wash as a sharp step.
 */
export const WASH_DESERT_BLEND_KM = 40;

/**
 * Which province holds the centre of each cell of a raster over the map, -1 at sea, and
 * how much of the land round the cell is desert, from 0 to 1.
 */
export interface ProvinceRaster {
  readonly columns: number;
  readonly rows: number;
  readonly province: Int16Array;
  readonly desert: Float32Array;
}

/** What one province's land is washed with: its owner, the colour, and how much of it. */
export interface Wash {
  readonly owner: string;
  readonly colour: number;
  readonly strength: number;
}

/** The parts of the map a wash reads. */
export interface WashedMap {
  readonly width: number;
  readonly height: number;
  readonly provinces: readonly { readonly outline: MultiPolygon }[];
  readonly terrain: readonly { readonly kind: string; readonly outline: MultiPolygon }[];
}

/** Rasterises the provinces' outlines and the desert. */
export function rasterise(map: WashedMap): ProvinceRaster {
  const columns = Math.ceil(map.width / WASH_CELL_KM);
  const rows = Math.ceil(map.height / WASH_CELL_KM);
  const province = new Int16Array(columns * rows).fill(-1);
  for (const [index, { outline }] of map.provinces.entries()) {
    fillCells(columns, rows, outline, (from, to) => province.fill(index, from, to));
  }
  const desert = new Float32Array(columns * rows);
  for (const { kind, outline } of map.terrain) {
    if (kind === 'desert')
      fillCells(columns, rows, outline, (from, to) => desert.fill(1, from, to));
  }
  const land = new Float32Array(province.length);
  for (let i = 0; i < province.length; i++) if ((province[i] as number) >= 0) land[i] = 1;
  const reach = Math.round(WASH_DESERT_BLEND_KM / WASH_CELL_KM);
  boxBlur(desert, columns, rows, reach);
  boxBlur(land, columns, rows, reach);
  for (let i = 0; i < desert.length; i++) {
    const near = land[i] as number;
    desert[i] = near > 0 ? Math.min(1, (desert[i] as number) / near) : 0;
  }
  return { columns, rows, province, desert };
}

/** Averages each value over the cells within `reach` along each row, then each column. */
function boxBlur(values: Float32Array, columns: number, rows: number, reach: number): void {
  const width = 2 * reach + 1;
  const row = new Float32Array(columns);
  for (let r = 0; r < rows; r++) {
    const base = r * columns;
    row.set(values.subarray(base, base + columns));
    let sum = 0;
    for (let c = 0; c < Math.min(reach, columns); c++) sum += row[c] as number;
    for (let c = 0; c < columns; c++) {
      if (c + reach < columns) sum += row[c + reach] as number;
      if (c > reach) sum -= row[c - reach - 1] as number;
      values[base + c] = sum / width;
    }
  }
  const copy = Float32Array.from(values);
  const sums = new Float32Array(columns);
  for (let r = 0; r < Math.min(reach, rows); r++) {
    for (let c = 0; c < columns; c++)
      sums[c] = (sums[c] as number) + (copy[r * columns + c] as number);
  }
  for (let r = 0; r < rows; r++) {
    const added = (r + reach) * columns;
    const dropped = (r - reach - 1) * columns;
    for (let c = 0; c < columns; c++) {
      let sum = sums[c] as number;
      if (r + reach < rows) sum += copy[added + c] as number;
      if (r > reach) sum -= copy[dropped + c] as number;
      sums[c] = sum;
      values[r * columns + c] = sum / width;
    }
  }
}

/** Calls `fill` with each run of cells whose centres lie inside the outline, by the even-odd rule. */
function fillCells(
  columns: number,
  rows: number,
  outline: MultiPolygon,
  fill: (from: number, to: number) => void,
): void {
  const crossings = new Map<number, number[]>();
  for (const ring of outline.flat()) {
    for (const [k, [ax, ay]] of ring.entries()) {
      const [bx, by] = ring[(k + 1) % ring.length] as readonly [number, number];
      if (ay === by) continue;
      const first = Math.max(0, Math.ceil(Math.min(ay, by) / WASH_CELL_KM - 0.5));
      const last = Math.min(rows, Math.ceil(Math.max(ay, by) / WASH_CELL_KM - 0.5));
      for (let r = first; r < last; r++) {
        const y = (r + 0.5) * WASH_CELL_KM;
        const row = crossings.get(r) ?? [];
        row.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        crossings.set(r, row);
      }
    }
  }
  for (const [r, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] as number) / WASH_CELL_KM - 0.5));
      const to = Math.min(columns, Math.ceil((xs[k + 1] as number) / WASH_CELL_KM - 0.5));
      if (to > from) fill(r * columns + from, r * columns + to);
    }
  }
}

/**
 * Paints the washes as RGBA, four bytes a cell. Each cell takes its province's colour,
 * full from WASH_FADE_KM.full over land from the nearest cell of another owner and clear
 * by WASH_FADE_KM.clear, so the wash runs on unbroken between two provinces of one owner
 * and fades toward the border of another. The sea stays clear, and the desert takes up
 * to WASH_DESERT_GAIN times the strength.
 */
export function paintWash(
  raster: ProvinceRaster,
  washes: readonly (Wash | undefined)[],
  into: Uint8ClampedArray,
): void {
  const { columns, rows, province, desert } = raster;
  const owners = new Map<string, number>();
  const ownerOf = washes.map((wash) => {
    if (!wash) return -1;
    if (!owners.has(wash.owner)) owners.set(wash.owner, owners.size);
    return owners.get(wash.owner) as number;
  });
  const owner = new Int16Array(province.length);
  for (let i = 0; i < province.length; i++) {
    const p = province[i] as number;
    owner[i] = p < 0 ? -2 : (ownerOf[p] as number);
  }
  const d = new Float32Array(province.length).fill(Infinity);
  const meet = (i: number, j: number) => {
    const a = owner[i] as number;
    const b = owner[j] as number;
    if (a !== b && a !== -2 && b !== -2) {
      d[i] = 0;
      d[j] = 0;
    }
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (c + 1 < columns) meet(i, i + 1);
      if (r + 1 < rows) {
        meet(i, i + columns);
        if (c + 1 < columns) meet(i, i + columns + 1);
        if (c > 0) meet(i, i + columns - 1);
      }
    }
  }
  const step = WASH_CELL_KM;
  const diagonal = WASH_CELL_KM * Math.SQRT2;
  const relax = (i: number, j: number, length: number) => {
    if (owner[j] === -2) return;
    const via = (d[j] as number) + length;
    if (via < (d[i] as number)) d[i] = via;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (owner[i] === -2) continue;
      if (c > 0) relax(i, i - 1, step);
      if (r > 0) {
        relax(i, i - columns, step);
        if (c > 0) relax(i, i - columns - 1, diagonal);
        if (c + 1 < columns) relax(i, i - columns + 1, diagonal);
      }
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = columns - 1; c >= 0; c--) {
      const i = r * columns + c;
      if (owner[i] === -2) continue;
      if (c + 1 < columns) relax(i, i + 1, step);
      if (r + 1 < rows) {
        relax(i, i + columns, step);
        if (c + 1 < columns) relax(i, i + columns + 1, diagonal);
        if (c > 0) relax(i, i + columns - 1, diagonal);
      }
    }
  }
  const { clear, full } = WASH_FADE_KM;
  for (let i = 0; i < province.length; i++) {
    const p = province[i] as number;
    const wash = p < 0 ? undefined : washes[p];
    const k = 4 * i;
    if (!wash) {
      into[k + 3] = 0;
      continue;
    }
    const t = Math.min(1, Math.max(0, ((d[i] as number) - clear) / (full - clear)));
    into[k] = (wash.colour >> 16) & 0xff;
    into[k + 1] = (wash.colour >> 8) & 0xff;
    into[k + 2] = wash.colour & 0xff;
    const gain = 1 + (WASH_DESERT_GAIN - 1) * (desert[i] as number);
    const strength = Math.min(1, wash.strength * gain);
    into[k + 3] = Math.round(255 * strength * t * t * (3 - 2 * t));
  }
}

export interface WashLayer {
  /** The wash, in km, clipped to the provinces' land. */
  readonly root: Container;
  /** Paints the washes again when they changed, and says whether they did. */
  paint(washes: readonly (Wash | undefined)[]): boolean;
}

export function createWash(map: GameMap): WashLayer {
  const raster = rasterise(map);
  const canvas = document.createElement('canvas');
  canvas.width = raster.columns;
  canvas.height = raster.rows;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('wash: no 2D canvas context');
  const image = context.createImageData(raster.columns, raster.rows);
  const texture = Texture.from(canvas);
  const sprite = new Sprite(texture);
  sprite.scale.set(WASH_CELL_KM);
  const land = new Graphics();
  for (const [outer, ...holes] of map.provinces.flatMap((province) => province.outline)) {
    if (!outer) continue;
    land.poly(outer.flat()).fill(0xffffff);
    for (const hole of holes) land.poly(hole.flat()).cut();
  }
  sprite.mask = land;
  const root = new Container({ label: 'wash' });
  root.addChild(sprite, land);
  let painted = '';
  return {
    root,
    paint(washes) {
      const key = washes
        .map((wash) => (wash ? `${wash.owner}:${wash.colour}:${wash.strength}` : ''))
        .join('|');
      if (key === painted) return false;
      painted = key;
      paintWash(raster, washes, image.data);
      context.putImageData(image, 0, 0);
      texture.source.update();
      return true;
    },
  };
}
