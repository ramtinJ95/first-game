import {
  KINDS,
  MOTIONS,
  posedFigure,
  standardArt,
  type FigureKind,
  type Motion,
} from './motions.ts';
import { n, paintSvg, type PaintOp } from './paint.ts';
import {
  CART_FRAMES,
  FIRE_FRAMES,
  SHIP_FRAMES,
  STANDARD_FRAMES,
  armsArt,
  arrowArt,
  cartArt,
  fireArt,
  flamesArt,
  javelinArt,
  ladderArt,
  puffArt,
  shipArt,
  stakesArt,
  tentArt,
} from './things.ts';

/** The motions each kind is drawn in. Civilians neither fight nor fall. */
export const KIND_MOTIONS: Readonly<Record<FigureKind, readonly Motion[]>> = {
  spearmen: ['stand', 'march', 'fight', 'run', 'fall'],
  swordsmen: ['stand', 'march', 'fight', 'run', 'fall'],
  skirmishers: ['stand', 'march', 'fight', 'run', 'fall'],
  archers: ['stand', 'march', 'fight', 'run', 'fall'],
  lightCavalry: ['stand', 'march', 'fight', 'run', 'fall'],
  heavyCavalry: ['stand', 'march', 'fight', 'run', 'fall'],
  general: ['stand', 'march', 'fight', 'run', 'fall'],
  bearer: ['stand', 'march', 'run', 'fall'],
  refugee: ['stand', 'march'],
  refugeeWoman: ['stand', 'march'],
};

/** Art that is the same for every faction, and how many frames each plays. */
export const SHARED = {
  fire: FIRE_FRAMES,
  blaze: FIRE_FRAMES,
  smoke: 1,
  dust: 1,
  arrow: 1,
  javelin: 1,
  ladder: 1,
  stakes: 1,
} as const;
export type Shared = keyof typeof SHARED;

/** Art in the owner's colour beside the figures, and how many frames each plays. */
export const OWNED = {
  standard: STANDARD_FRAMES,
  ship: SHIP_FRAMES,
  cart: CART_FRAMES,
  tent: 1,
  commandTent: 1,
  arms: 1,
} as const;
export type Owned = keyof typeof OWNED;

export const figureKey = (kind: FigureKind, motion: Motion, frame: number) =>
  `${kind}.${motion}.${frame}`;
export const artKey = (art: Shared | Owned, frame = 0) => `${art}.${frame}`;

interface CellArt {
  readonly key: string;
  readonly owned: boolean;
  readonly ops: PaintOp[];
  /** Degrees the picture turns about its origin. */
  readonly turn: number;
}

function frameTime(motion: Motion, frame: number): number {
  const { frames, loop } = MOTIONS[motion];
  return loop ? frame / frames : frame / (frames - 1);
}

function sharedOps(art: Shared, t: number): PaintOp[] {
  switch (art) {
    case 'fire':
      return fireArt(t);
    case 'blaze':
      return flamesArt(t);
    case 'smoke':
      return puffArt('#5f584e', '#9a9286');
    case 'dust':
      return puffArt('#b39566', '#d8c196');
    case 'arrow':
      return arrowArt();
    case 'javelin':
      return javelinArt();
    case 'ladder':
      return ladderArt();
    case 'stakes':
      return stakesArt();
  }
}

function ownedOps(art: Owned, t: number): PaintOp[] {
  switch (art) {
    case 'standard':
      return standardArt(t);
    case 'ship':
      return shipArt(t, 1);
    case 'cart':
      return cartArt(t);
    case 'tent':
      return tentArt(false);
    case 'commandTent':
      return tentArt(true);
    case 'arms':
      return armsArt();
  }
}

/** Every picture the map draws, frame by frame. */
export function sheetArt(): CellArt[] {
  const cells: CellArt[] = [];
  for (const kind of Object.keys(KINDS) as FigureKind[]) {
    for (const motion of KIND_MOTIONS[kind]) {
      for (let frame = 0; frame < MOTIONS[motion].frames; frame++) {
        const { ops, turn } = posedFigure(kind, motion, frameTime(motion, frame));
        cells.push({ key: figureKey(kind, motion, frame), owned: true, ops, turn });
      }
    }
  }
  for (const art of Object.keys(OWNED) as Owned[]) {
    for (let frame = 0; frame < OWNED[art]; frame++) {
      cells.push({
        key: artKey(art, frame),
        owned: true,
        ops: ownedOps(art, frame / OWNED[art]),
        turn: 0,
      });
    }
  }
  for (const art of Object.keys(SHARED) as Shared[]) {
    for (let frame = 0; frame < SHARED[art]; frame++) {
      cells.push({
        key: artKey(art, frame),
        owned: false,
        ops: sharedOps(art, frame / SHARED[art]),
        turn: 0,
      });
    }
  }
  return cells;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The bounds of a path this module's helpers wrote: absolute M, L, and C points, arcs
 * by their end point and radius, and the relative arcs of a circle.
 */
export function pathBounds(d: string, box: Box, margin: number) {
  const tokens = d.match(/[MLCAaZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let command = 'M';
  let i = 0;
  let at = { x: 0, y: 0 };
  const take = () => Number(tokens[i++]);
  const include = (x: number, y: number, r = 0) => {
    box.minX = Math.min(box.minX, x - r - margin);
    box.minY = Math.min(box.minY, y - r - margin);
    box.maxX = Math.max(box.maxX, x + r + margin);
    box.maxY = Math.max(box.maxY, y + r + margin);
  };
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (/[MLCAaZ]/.test(token)) {
      command = token;
      i++;
      if (command === 'Z') continue;
    }
    if (command === 'M' || command === 'L') {
      at = { x: take(), y: take() };
      include(at.x, at.y);
    } else if (command === 'C') {
      for (let k = 0; k < 3; k++) include(take(), take());
    } else if (command === 'A' || command === 'a') {
      const rx = take();
      const ry = take();
      i += 3;
      const x = take();
      const y = take();
      at = command === 'A' ? { x, y } : { x: at.x + x, y: at.y + y };
      include(at.x, at.y, Math.max(rx, ry));
    } else {
      i++;
    }
  }
}

function turnBox(box: Box, degrees: number): Box {
  if (degrees === 0) return box;
  const r = (degrees * Math.PI) / 180;
  const corners = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.maxY],
  ] as const;
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of corners) {
    const tx = x * Math.cos(r) - y * Math.sin(r);
    const ty = x * Math.sin(r) + y * Math.cos(r);
    out.minX = Math.min(out.minX, tx);
    out.minY = Math.min(out.minY, ty);
    out.maxX = Math.max(out.maxX, tx);
    out.maxY = Math.max(out.maxY, ty);
  }
  return out;
}

export function artBounds(ops: readonly PaintOp[], turn = 0): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const op of ops) pathBounds(op.d, box, (op.stroke ?? 0) / 2 + 0.5);
  return turnBox(box, turn);
}

/** Where a picture sits in the sheet, in pixels, and where its origin falls in it. */
export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The picture's origin, as a share of the cell from its top left. */
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface SheetLayout {
  /** Pixels per 100 figure units, a man's height. */
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** Whether this sheet holds the art in an owner's colour, or the art every faction shares. */
  readonly owned: boolean;
  readonly cells: ReadonlyMap<string, Cell>;
}

const PAD = 1;

/**
 * Packs the owned pictures, or the shared ones, into rows of a sheet `width` pixels
 * wide, tallest first. A colour's sheet is the owned layout painted in that colour.
 * The same size always gives the same sheet.
 */
export function layoutSheet(
  art: readonly CellArt[],
  owned: boolean,
  size: number,
  width = 2048,
): SheetLayout {
  const k = size / 100;
  const pieces = art
    .filter((cell) => cell.owned === owned)
    .map((cell) => {
      const box = artBounds(cell.ops, cell.turn);
      const w = Math.ceil((box.maxX - box.minX) * k) + 2 * PAD;
      const h = Math.ceil((box.maxY - box.minY) * k) + 2 * PAD;
      return { key: cell.key, w, h, box };
    });
  pieces.sort((a, b) => b.h - a.h || a.key.localeCompare(b.key));
  const cells = new Map<string, Cell>();
  let x = 0;
  let y = 0;
  let row = 0;
  for (const piece of pieces) {
    if (x + piece.w > width) {
      x = 0;
      y += row;
      row = 0;
    }
    const originX = PAD - piece.box.minX * k;
    const originY = PAD - piece.box.minY * k;
    cells.set(piece.key, {
      x,
      y,
      width: piece.w,
      height: piece.h,
      anchorX: originX / piece.w,
      anchorY: originY / piece.h,
    });
    x += piece.w;
    row = Math.max(row, piece.h);
  }
  return { size, owned, width, height: y + row, cells };
}

/**
 * The SVG of a band of a sheet from `top` to `bottom` px, its owned art painted in
 * `colour`. The band holds the cells that start in it, drawn from its own top.
 */
export function sheetSvg(
  layout: SheetLayout,
  art: readonly CellArt[],
  colour: number,
  top = 0,
  bottom = layout.height,
): string {
  const k = layout.size / 100;
  let body = '';
  let height = 0;
  for (const cell of art) {
    const at = layout.cells.get(cell.key);
    if (!at || at.y < top || at.y >= bottom) continue;
    height = Math.max(height, at.y + at.height - top);
    const ox = at.x + at.anchorX * at.width;
    const oy = at.y - top + at.anchorY * at.height;
    const turn = cell.turn ? ` rotate(${n(cell.turn)})` : '';
    body += `<g transform="translate(${n(ox)} ${n(oy)}) scale(${k})${turn}">${paintSvg(cell.ops, colour)}</g>`;
  }
  const h = Math.max(1, Math.ceil(height));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${h}" viewBox="0 0 ${layout.width} ${h}">${body}</svg>`;
}

/** The tops of the rows of a sheet, the places a band may start or end. */
export function sheetRows(layout: SheetLayout): number[] {
  return [...new Set([...layout.cells.values()].map((cell) => cell.y))].sort((a, b) => a - b);
}

const spans = new Map<FigureKind, number>();

/**
 * How far a figure's feet, hooves, or spear butt reach to either side of its origin, in
 * men's heights, over every frame it stands or walks: the ground it covers, which must
 * be land.
 */
export function groundSpan(kind: FigureKind): number {
  const known = spans.get(kind);
  if (known !== undefined) return known;
  let span = 0;
  for (const motion of KIND_MOTIONS[kind]) {
    if (motion === 'fall') continue;
    for (let frame = 0; frame < MOTIONS[motion].frames; frame++) {
      for (const op of posedFigure(kind, motion, frameTime(motion, frame)).ops) {
        const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        pathBounds(op.d, box, 0);
        if (box.maxY >= GROUND_CONTACT) span = Math.max(span, -box.minX, box.maxX);
      }
    }
  }
  spans.set(kind, span / 100);
  return span / 100;
}

/** A shape whose lowest point is at most this far above the origin, in figure units, touches the ground. */
const GROUND_CONTACT = -8;
