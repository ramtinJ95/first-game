import { GraphicsContext } from 'pixi.js';
import type { MultiPolygon, Peak } from '../../sim/map.ts';
import { INK, PAPER } from '../palette.ts';
import { VALLEY, WOOD_RIM, type Crop, type Mark, type Tier, type Wood } from './marks.ts';
import { stream } from './random.ts';

export function mix(from: number, to: number, t: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

const SEPIA = 0x5b3f22;
export const TERRAIN_COLOURS = {
  reliefInk: mix(INK, SEPIA, 0.35),
  reliefLight: mix(PAPER, 0xfff8e6, 0.45),
  reliefShade: mix(PAPER, SEPIA, 0.42),
  reliefDeep: mix(PAPER, SEPIA, 0.6),
  hillShade: mix(PAPER, SEPIA, 0.2),
  desert: 0xf3d597,
  dune: mix(0xf3d597, 0x8a5a26, 0.62),
  stipple: mix(0xf3d597, 0x6e4a24, 0.7),
  woodEdge: mix(PAPER, 0x8a9e5e, 0.12),
  woodRim: mix(PAPER, 0x8a9e5e, 0.22),
  wood: mix(PAPER, 0x8a9e5e, 0.3),
  cultivatedEdge: mix(PAPER, 0x92a85a, 0.25),
  cultivated: mix(PAPER, 0x86a04c, 0.48),
  crownLight: mix(PAPER, 0x7d9a4e, 0.5),
  coniferLight: mix(PAPER, 0x5d7a48, 0.55),
  duneShade: mix(0xf3d597, 0x9a6a34, 0.6),
  crown: mix(PAPER, 0x5f7a3c, 0.62),
  conifer: mix(PAPER, 0x43603a, 0.7),
  cypress: mix(PAPER, 0x3a5230, 0.75),
  crownShade: mix(PAPER, 0x2f4423, 0.7),
  treeInk: mix(INK, 0x2f3a1e, 0.4),
  furrow: mix(PAPER, SEPIA, 0.42),
  track: mix(PAPER, SEPIA, 0.62),
} as const;

/**
 * A mountain's lit side lets the wash under it show through, so it reads as the lit side
 * of the owner's land and not as a white patch, while staying lighter than the land.
 */
const RELIEF_LIGHT = { color: TERRAIN_COLOURS.reliefLight, alpha: 0.55 } as const;

const CROP_COLOURS: Record<Crop, number> = {
  grain: mix(PAPER, 0xd4a63c, 0.78),
  stubble: mix(PAPER, 0xa9824a, 0.62),
  green: mix(PAPER, 0x7f9a45, 0.8),
  fallow: mix(PAPER, 0x8c6a46, 0.42),
};

/**
 * Ink widths in km for each tier. A tier shows over about a fourfold range of zoom, so
 * a width in km reads as about one pixel in the middle of that range.
 */
const INK_KM: Record<Tier, number> = { wide: 3.1, middle: 0.95, close: 0.4 };

function mountain(g: GraphicsContext, m: Extract<Mark, { kind: 'mountain' }>, tier: Tier) {
  const { x, y, width: w, height: h, high } = m;
  const random = stream(m.seed);
  const sx = x + (random() - 0.5) * 0.2 * w;
  const sy = y - h;
  const twin = high > 0.45 && random() < 0.35;
  const lx = x - w * (0.2 + 0.1 * random());
  const ly = y - h * (twin ? 0.78 : 0.4 + 0.2 * random());
  const rx = x + w * (0.17 + 0.12 * random());
  const ry = y - h * (0.36 + 0.2 * random());
  const left = x - w / 2;
  const right = x + w / 2;
  const ink = INK_KM[tier] * (0.75 + 0.6 * high);
  const outline = twin
    ? [
        left,
        y,
        lx - w * 0.06,
        ly + h * 0.06,
        lx,
        ly,
        (lx + sx) / 2,
        y - h * 0.6,
        sx,
        sy,
        rx,
        ry,
        right,
        y,
      ]
    : [left, y, lx, ly, sx, sy, rx, ry, right, y];
  g.poly(outline).fill(RELIEF_LIGHT);
  const spurX = sx + w * (0.05 + 0.06 * random());
  const spurY = y - h * (0.3 + 0.15 * random());
  g.poly([sx, sy, rx, ry, right, y, spurX + w * 0.08, y, spurX, spurY]).fill(
    high > 0.55 ? TERRAIN_COLOURS.reliefDeep : TERRAIN_COLOURS.reliefShade,
  );
  {
    const hatches = tier === 'close' ? 4 + Math.floor(random() * 3) : 2;
    for (let n = 1; n <= hatches; n++) {
      const t = n / (hatches + 1);
      const px = sx + (lx - sx) * t;
      const py = sy + (ly - sy) * t;
      g.moveTo(px, py).lineTo(px + w * 0.05, py + h * (0.16 + 0.1 * random()));
    }
    g.stroke({ width: ink * 0.45, color: TERRAIN_COLOURS.reliefInk, alpha: 0.55, cap: 'round' });
  }
  for (let n = 0; n < outline.length - 2; n += 2) {
    if (n === 0) g.moveTo(outline[0] as number, outline[1] as number);
    g.lineTo(outline[n + 2] as number, outline[n + 3] as number);
  }
  g.stroke({ width: ink, color: TERRAIN_COLOURS.reliefInk, join: 'round', cap: 'round' });
  {
    g.moveTo(sx, sy)
      .lineTo(spurX, spurY)
      .stroke({ width: ink * 0.6, color: TERRAIN_COLOURS.reliefInk, alpha: 0.75, cap: 'round' });
  }
}

function hill(g: GraphicsContext, m: Extract<Mark, { kind: 'hill' }>, tier: Tier) {
  const { x, y, width: w, height: h } = m;
  const left = x - w / 2;
  const right = x + w / 2;
  const ink = INK_KM[tier] * 0.75;
  g.moveTo(x, y - h)
    .quadraticCurveTo(x + w * 0.4, y - h * 0.8, right, y)
    .quadraticCurveTo(x + w * 0.2, y - h * 0.3, x, y - h)
    .fill(TERRAIN_COLOURS.hillShade);
  g.moveTo(left, y)
    .bezierCurveTo(x - w * 0.3, y - h * 1.3, x + w * 0.25, y - h * 1.35, right, y)
    .stroke({ width: ink, color: TERRAIN_COLOURS.reliefInk, alpha: 0.7, cap: 'round' });
  if (tier === 'close') {
    const random = stream(m.seed);
    for (let n = 0; n < 3; n++) {
      const px = x + w * (0.1 + 0.11 * n);
      const py = y - h * (0.95 - 0.22 * n);
      g.moveTo(px, py).lineTo(px + w * 0.03, py + h * (0.35 + 0.15 * random()));
    }
    g.stroke({ width: ink * 0.6, color: TERRAIN_COLOURS.reliefInk, alpha: 0.5, cap: 'round' });
  }
}

function tree(g: GraphicsContext, m: Extract<Mark, { kind: 'tree' }>, tier: Tier) {
  const { x, y, size: s, shape } = m;
  if (tier === 'wide') {
    const r = s * 0.3;
    g.circle(x + r * 0.35, y - s * 0.5 + r * 0.3, r).fill(TERRAIN_COLOURS.crownShade);
    g.circle(x, y - s * 0.5, r).fill(
      shape === 'broadleaf' ? TERRAIN_COLOURS.crown : TERRAIN_COLOURS.conifer,
    );
    return;
  }
  const close = tier === 'close';
  const ink = INK_KM[tier] * 0.7;
  const line = { width: ink, color: TERRAIN_COLOURS.treeInk, cap: 'round', join: 'round' } as const;
  if (shape === 'conifer' || shape === 'cypress') {
    const half = shape === 'conifer' ? s * 0.27 : s * 0.15;
    const top = y - s * (shape === 'conifer' ? 1.1 : 1.2);
    const base = y - s * 0.2;
    const dark = shape === 'conifer' ? TERRAIN_COLOURS.conifer : TERRAIN_COLOURS.cypress;
    g.moveTo(x, y).lineTo(x, base).stroke(line);
    if (shape === 'conifer') {
      g.poly([x - half, base, x, top, x, base]).fill(close ? TERRAIN_COLOURS.coniferLight : dark);
      g.poly([x, top, x + half, base, x, base]).fill(close ? TERRAIN_COLOURS.crownShade : dark);
      g.poly([x - half, base, x, top, x + half, base]).stroke(line);
    } else {
      g.moveTo(x, base + s * 0.05)
        .quadraticCurveTo(x - half * 1.4, y - s * 0.6, x, top)
        .lineTo(x, base + s * 0.05)
        .fill(close ? TERRAIN_COLOURS.coniferLight : dark);
      g.moveTo(x, top)
        .quadraticCurveTo(x + half * 1.4, y - s * 0.6, x, base + s * 0.05)
        .lineTo(x, top)
        .fill(close ? TERRAIN_COLOURS.crownShade : dark);
      g.moveTo(x, base + s * 0.05)
        .quadraticCurveTo(x - half * 1.4, y - s * 0.6, x, top)
        .quadraticCurveTo(x + half * 1.4, y - s * 0.6, x, base + s * 0.05)
        .stroke(line);
    }
    return;
  }
  const r = s * 0.4;
  const cy = y - s * 0.62;
  g.moveTo(x, y)
    .lineTo(x, cy + r * 0.6)
    .stroke(line);
  g.circle(x, cy, r).fill(TERRAIN_COLOURS.crown);
  if (close) {
    g.moveTo(x + r * 0.15, cy - r * 0.98)
      .arc(x, cy, r, -Math.PI / 2 + 0.15, Math.PI / 2 + 0.2)
      .quadraticCurveTo(x + r * 0.6, cy, x + r * 0.15, cy - r * 0.98)
      .fill(TERRAIN_COLOURS.crownShade);
    g.circle(x - r * 0.35, cy - r * 0.35, r * 0.32).fill(TERRAIN_COLOURS.crownLight);
  }
  g.circle(x, cy, r).stroke(line);
}

function dune(g: GraphicsContext, m: Extract<Mark, { kind: 'dune' }>, tier: Tier) {
  const { x, y, length, angle } = m;
  const ux = Math.cos(angle) * (length / 2);
  const uy = Math.sin(angle) * (length / 2);
  const bend = 0.28;
  const nx = -uy * bend;
  const ny = ux * bend;
  const ink = INK_KM[tier] * 0.8;
  g.moveTo(x - ux, y - uy)
    .quadraticCurveTo(x + nx * 2, y + ny * 2, x + ux, y + uy)
    .stroke({ width: ink, color: TERRAIN_COLOURS.dune, alpha: 0.85, cap: 'round' });
  if (tier === 'close') {
    g.moveTo(x - ux, y - uy)
      .quadraticCurveTo(x + nx * 2, y + ny * 2, x + ux, y + uy)
      .quadraticCurveTo(x + nx * 3.2, y + ny * 3.2, x - ux, y - uy)
      .fill({ color: TERRAIN_COLOURS.duneShade, alpha: 0.8 });
    g.moveTo(x - ux * 0.6 + nx * 0.9, y - uy * 0.6 + ny * 0.9)
      .quadraticCurveTo(
        x + nx * 2.6,
        y + ny * 2.6,
        x + ux * 0.6 + nx * 0.9,
        y + uy * 0.6 + ny * 0.9,
      )
      .stroke({ width: ink * 0.6, color: TERRAIN_COLOURS.dune, alpha: 0.55, cap: 'round' });
  }
}

function stipple(g: GraphicsContext, m: Extract<Mark, { kind: 'stipple' }>, tier: Tier) {
  const random = stream(m.seed);
  const dot = INK_KM[tier] * 0.7;
  const count = 3 + Math.floor(random() * 4);
  for (let n = 0; n < count; n++) {
    const a = random() * Math.PI * 2;
    const d = m.spread * Math.sqrt(random());
    g.rect(m.x + Math.cos(a) * d - dot / 2, m.y + Math.sin(a) * d - dot / 2, dot, dot);
  }
  g.fill(TERRAIN_COLOURS.stipple);
}

function corners(x: number, y: number, w: number, d: number, angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number) => [x + u * c - v * s, y + u * s + v * c];
  return [...at(-w / 2, -d / 2), ...at(w / 2, -d / 2), ...at(w / 2, d / 2), ...at(-w / 2, d / 2)];
}

function field(g: GraphicsContext, m: Extract<Mark, { kind: 'field' }>) {
  const { x, y, width: w, depth: d, angle } = m;
  g.poly(corners(x, y, w, d, angle)).fill(CROP_COLOURS[m.crop]);
  if (m.crop === 'fallow') return;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rows = Math.max(2, Math.round(d / 0.32));
  for (let n = 1; n < rows; n++) {
    const v = -d / 2 + (d * n) / rows;
    g.moveTo(x - (w / 2) * c * 0.92 - v * s, y - (w / 2) * s * 0.92 + v * c).lineTo(
      x + (w / 2) * c * 0.92 - v * s,
      y + (w / 2) * s * 0.92 + v * c,
    );
  }
  g.stroke({ width: 0.12, color: TERRAIN_COLOURS.furrow, alpha: 0.85 });
}

function orchard(g: GraphicsContext, m: Extract<Mark, { kind: 'orchard' }>) {
  const { x, y, width: w, depth: d, angle } = m;
  g.poly(corners(x, y, w, d, angle)).fill(mix(PAPER, CROP_COLOURS.green, 0.6));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const step = 0.55;
  for (let u = -w / 2 + step / 2; u < w / 2; u += step) {
    for (let v = -d / 2 + step / 2; v < d / 2; v += step) {
      g.circle(x + u * c - v * s, y + u * s + v * c, 0.17);
    }
  }
  g.fill(TERRAIN_COLOURS.crown);
}

function track(g: GraphicsContext, m: Extract<Mark, { kind: 'track' }>) {
  const [first, ...rest] = m.points;
  if (!first) return;
  g.moveTo(first[0], first[1]);
  for (const [px, py] of rest) g.lineTo(px, py);
  g.stroke({ width: 0.22, color: TERRAIN_COLOURS.track, alpha: 0.9, cap: 'round', join: 'round' });
}

const GROUND_INK = mix(INK, SEPIA, 0.45);
const GRASS = mix(PAPER, 0x7f8f4a, 0.55);
const SCRUB = mix(PAPER, 0x5f7a3c, 0.5);
const SCRUB_SHADE = mix(PAPER, 0x2f4423, 0.55);
const ROCK_LIT = mix(PAPER, 0xfff8e6, 0.5);
const ROCK = mix(PAPER, SEPIA, 0.32);
const ROCK_SHADE = mix(PAPER, SEPIA, 0.55);
const STREAM = 0x557d8c;

type GroundMark = Extract<Mark, { kind: 'tuft' | 'scrub' | 'rock' | 'stream' }>;

/**
 * The open ground's marks, drawn in one pass by colour: every tuft's blades in one
 * stroke, every bush's crowns, shades, and outlines in one fill or stroke each, and so on.
 * There are thousands of them in a close view, and a drawing call apiece made each redraw
 * of the terrain texture cost three times as much. They seldom overlap, so the order
 * among them does not show.
 */
function ground(g: GraphicsContext, marks: readonly GroundMark[]) {
  const tufts = marks.filter((m) => m.kind === 'tuft');
  const bushes = marks.filter((m) => m.kind === 'scrub');
  const rocks = marks.filter((m) => m.kind === 'rock');
  const streams = marks.filter((m) => m.kind === 'stream');

  for (const m of streams) {
    const [first, ...rest] = m.points;
    if (!first) continue;
    g.moveTo(first[0], first[1]);
    for (const [px, py] of rest) g.lineTo(px, py);
  }
  if (streams.length)
    g.stroke({ width: 0.2, color: STREAM, alpha: 0.85, cap: 'round', join: 'round' });

  for (const m of tufts) {
    const random = stream(m.seed);
    const blades = 4 + Math.floor(random() * 3);
    for (let n = 0; n < blades; n++) {
      const a = -Math.PI / 2 + (n / (blades - 1) - 0.5) * 1.5 + (random() - 0.5) * 0.2;
      const length = m.size * (0.55 + 0.45 * random());
      g.moveTo(m.x, m.y).lineTo(m.x + Math.cos(a) * length, m.y + Math.sin(a) * length);
    }
  }
  if (tufts.length) g.stroke({ width: 0.16, color: GRASS, cap: 'round' });
  for (const m of tufts) g.moveTo(m.x - m.size * 0.35, m.y).lineTo(m.x + m.size * 0.35, m.y);
  if (tufts.length) g.stroke({ width: 0.12, color: GROUND_INK, alpha: 0.6, cap: 'round' });

  const crowns = bushes.flatMap((m) => {
    const random = stream(m.seed);
    const count = 1 + Math.floor(random() * 2);
    return Array.from({ length: count }, (_, n) => {
      const r = m.size * (0.36 + 0.18 * random());
      return { x: m.x + (n - (count - 1) / 2) * r * 1.3, y: m.y - r * (0.8 + 0.2 * random()), r };
    });
  });
  for (const c of crowns) g.circle(c.x, c.y, c.r);
  if (crowns.length) g.fill(SCRUB);
  for (const c of crowns) g.circle(c.x + c.r * 0.3, c.y + c.r * 0.25, c.r * 0.7);
  if (crowns.length) g.fill(SCRUB_SHADE);
  for (const c of crowns) g.circle(c.x, c.y, c.r);
  if (crowns.length) g.stroke({ width: 0.12, color: INK, alpha: 0.75 });

  const shapes = rocks.map((m) => {
    const random = stream(m.seed);
    const w = m.size * (0.7 + 0.4 * random());
    const h = w * (0.45 + 0.2 * random());
    const peak = (random() - 0.5) * w * 0.4;
    const { x, y } = m;
    return {
      outline: [
        x - w / 2,
        y,
        x - w * 0.35,
        y - h * 0.7,
        x + peak,
        y - h,
        x + w * 0.4,
        y - h * 0.55,
        x + w / 2,
        y,
      ],
      shade: [x + peak, y - h, x + w * 0.4, y - h * 0.55, x + w / 2, y, x + peak * 0.5, y],
      lit: [x - w * 0.35, y - h * 0.7, x + peak, y - h, x - w * 0.05, y - h * 0.55],
    };
  });
  for (const r of shapes) g.poly(r.outline);
  if (shapes.length) g.fill(ROCK);
  for (const r of shapes) g.poly(r.shade);
  if (shapes.length) g.fill(ROCK_SHADE);
  for (const r of shapes) g.poly(r.lit);
  if (shapes.length) g.fill(ROCK_LIT);
  for (const r of shapes) g.poly(r.outline);
  if (shapes.length) g.stroke({ width: 0.13, color: INK, join: 'round' });
}

/** Draws marks of one tier into a new context, in the order given. */
export function drawMarks(marks: readonly Mark[], tier: Tier): GraphicsContext {
  const g = new GraphicsContext();
  // The ground lies flat, under the relief and the trees of its tier.
  const groundMarks = marks.filter(
    (m): m is GroundMark =>
      m.kind === 'tuft' || m.kind === 'scrub' || m.kind === 'rock' || m.kind === 'stream',
  );
  if (groundMarks.length) ground(g, groundMarks);
  for (const m of marks) {
    switch (m.kind) {
      case 'mountain':
        mountain(g, m, tier);
        break;
      case 'hill':
        hill(g, m, tier);
        break;
      case 'tree':
        tree(g, m, tier);
        break;
      case 'dune':
        dune(g, m, tier);
        break;
      case 'stipple':
        stipple(g, m, tier);
        break;
      case 'field':
        field(g, m);
        break;
      case 'orchard':
        orchard(g, m);
        break;
      case 'track':
        track(g, m);
        break;
      case 'tuft':
      case 'scrub':
      case 'rock':
      case 'stream':
        break;
    }
  }
  return g;
}

/** A named peak: a taller mountain with darker shading, and a snow line at the top. */
export function drawPeaks(peaks: readonly Peak[], tier: Tier): GraphicsContext {
  const g = new GraphicsContext();
  const ink = INK_KM[tier];
  const base = tier === 'close' ? 10 : 15;
  for (const peak of peaks) {
    const [x, y] = peak.at;
    const w = base * (0.55 + 0.6 * Math.min(1, peak.height / 4800));
    const h = w * 0.85;
    const foot = y + h * 0.3;
    const sy = foot - h;
    g.poly([
      x - w / 2,
      foot,
      x - w * 0.18,
      foot - h * 0.55,
      x,
      sy,
      x + w * 0.2,
      foot - h * 0.6,
      x + w / 2,
      foot,
    ]).fill(RELIEF_LIGHT);
    g.poly([
      x,
      sy,
      x + w * 0.2,
      foot - h * 0.6,
      x + w / 2,
      foot,
      x + w * 0.1,
      foot,
      x + w * 0.04,
      foot - h * 0.45,
    ]).fill(mix(TERRAIN_COLOURS.reliefShade, SEPIA, 0.25));
    g.poly([
      x - w * 0.11,
      sy + h * 0.2,
      x,
      sy,
      x + w * 0.09,
      sy + h * 0.17,
      x + w * 0.02,
      sy + h * 0.24,
    ]).fill(0xfffaf0);
    g.moveTo(x - w / 2, foot)
      .lineTo(x - w * 0.18, foot - h * 0.55)
      .lineTo(x, sy)
      .lineTo(x + w * 0.2, foot - h * 0.6)
      .lineTo(x + w / 2, foot)
      .stroke({ width: ink * 1.4, color: INK, join: 'round', cap: 'round' });
    g.moveTo(x - w * 0.11, sy + h * 0.2)
      .lineTo(x + w * 0.02, sy + h * 0.24)
      .lineTo(x + w * 0.09, sy + h * 0.17)
      .stroke({ width: ink * 0.6, color: INK, alpha: 0.7, join: 'round' });
  }
  return g;
}

/** The pale, warm ground of the deserts. */
export function drawDesert(outlines: readonly MultiPolygon[]): GraphicsContext {
  const g = new GraphicsContext();
  for (const outline of outlines) {
    for (const [outer, ...holes] of outline) {
      if (!outer) continue;
      g.poly(outer.flat()).fill(TERRAIN_COLOURS.desert);
      for (const hole of holes) g.poly(hole.flat()).cut();
    }
  }
  return g;
}

/** A lobe's outline, wobbled a little so a wood's edge looks drawn by hand. */
function lobe(g: GraphicsContext, x: number, y: number, r: number) {
  const points: number[] = [];
  const sides = 20;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const wobble = 1 + 0.09 * Math.sin(a * 3 + x * 0.7) + 0.05 * Math.sin(a * 7 + y * 0.9);
    points.push(x + Math.cos(a) * r * wobble, y + Math.sin(a) * r * wobble);
  }
  g.poly(points);
}

/**
 * The green ground of the woods. Each lobe is drawn in three steps of colour, each one
 * opaque, so the edge of a wood fades into the paper and lobes that overlap never
 * darken where they meet, under any wash.
 */
export function drawWoods(woods: readonly Wood[]): GraphicsContext {
  const g = new GraphicsContext();
  const steps = [
    { r: WOOD_RIM, color: TERRAIN_COLOURS.woodEdge },
    { r: 1.08, color: TERRAIN_COLOURS.woodRim },
    { r: 0.94, color: TERRAIN_COLOURS.wood },
  ];
  for (const { r, color } of steps) {
    for (const wood of woods) for (const l of wood.lobes) lobe(g, l.x, l.y, l.r * r);
    g.fill(color);
  }
  return g;
}

/** The watered strips along desert rivers, and their deltas, as green cultivated ground. */
export function drawValleys(
  valleys: readonly (readonly (readonly [number, number])[])[],
  deltas: readonly (readonly [number, number])[][],
): GraphicsContext {
  const g = new GraphicsContext();
  const trace = () => {
    for (const line of valleys) {
      const [first, ...rest] = line;
      if (!first) continue;
      g.moveTo(first[0], first[1]);
      for (const [x, y] of rest) g.lineTo(x, y);
    }
  };
  for (const delta of deltas) g.poly(delta.flat()).fill(TERRAIN_COLOURS.cultivatedEdge);
  trace();
  g.stroke({
    width: 2 * VALLEY.width,
    color: TERRAIN_COLOURS.cultivatedEdge,
    cap: 'round',
    join: 'round',
  });
  trace();
  g.stroke({
    width: 2 * VALLEY.width - 7,
    color: TERRAIN_COLOURS.cultivated,
    cap: 'round',
    join: 'round',
  });
  for (const delta of deltas) {
    const [apex] = delta;
    if (!apex) continue;
    const inner = delta.map(([x, y]) => [
      apex[0] + (x - apex[0]) * 0.9,
      apex[1] + (y - apex[1]) * 0.9,
    ]);
    g.poly(inner.flat()).fill(TERRAIN_COLOURS.cultivated);
  }
  return g;
}
