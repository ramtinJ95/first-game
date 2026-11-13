import { GraphicsContext } from 'pixi.js';
import type { MultiPolygon, Peak } from '../../sim/map.ts';
import { INK, PAPER } from '../palette.ts';
import {
  PAN_RIM,
  VALLEY,
  WOOD_RIM,
  type Crop,
  type Land,
  type Mark,
  type Tier,
  type Wood,
} from './marks.ts';
import { stream, valueNoise } from './random.ts';

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
  foldLight: mix(PAPER, 0xfff1d2, 0.5),
  foldShade: mix(PAPER, 0x8f5d2e, 0.42),
  foldDeep: mix(PAPER, 0x7a4a26, 0.58),
  foldInk: mix(INK, 0x7a4a26, 0.35),
  dryGround: 0xdcc38c,
  aridGround: 0xd2ad7a,
  saltEdge: mix(0xf3d597, 0xf2efe4, 0.45),
  saltRim: mix(0xf3d597, 0xf2efe4, 0.75),
  salt: 0xf2efe4,
  saltCrack: mix(0xf2efe4, 0x6b5a45, 0.62),
} as const;

/** The ground tint's raster cell, in km. */
export const TINT_CELL = 16;

export interface GroundTint {
  readonly width: number;
  readonly height: number;
  /** Opaque RGBA, row by row from the north-west corner, one pixel per `TINT_CELL` km. */
  readonly pixels: Uint8Array;
}

/**
 * The colour of the bare ground under the washes: the paper on green land, warming to
 * straw on dry land and to buff on arid land, mottled so it reads as soil and not as a
 * flat fill. Each pixel is opaque, so drawn over the paper it is the paper where the land
 * is green, and the pixels blend smoothly into each other when drawn larger.
 */
export function groundTint(land: Land, width: number, height: number): GroundTint {
  const columns = Math.ceil(width / TINT_CELL);
  const rows = Math.ceil(height / TINT_CELL);
  const pixels = new Uint8Array(columns * rows * 4);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = (i + 0.5) * TINT_CELL;
      const y = (j + 0.5) * TINT_CELL;
      const { dry, arid } = land.dryness(x, y);
      let colour = PAPER;
      if (dry > 0) {
        const mottle = 0.7 + 0.35 * valueNoise(x, y, 70, 611) + 0.25 * valueNoise(x, y, 36, 612);
        colour = mix(PAPER, TERRAIN_COLOURS.dryGround, Math.min(1, dry * mottle * 0.85));
        colour = mix(colour, TERRAIN_COLOURS.aridGround, Math.min(1, arid * dry * mottle * 0.8));
      }
      const k = (j * columns + i) * 4;
      pixels[k] = (colour >> 16) & 0xff;
      pixels[k + 1] = (colour >> 8) & 0xff;
      pixels[k + 2] = colour & 0xff;
      pixels[k + 3] = 0xff;
    }
  }
  return { width: columns, height: rows, pixels };
}

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

/** The way the light comes from, toward the north-west, as on every drawing of relief. */
const LIGHT = { x: -0.6, y: -0.8 } as const;

/**
 * A fold seen from above, as the long ridges of the Zagros show from the air: a long oval
 * along its range, its flank toward the light pale and the other shaded, with the edges
 * of its bent strata as rings inside it and short ticks where they dip on the shaded side.
 */
function fold(g: GraphicsContext, m: Extract<Mark, { kind: 'fold' }>, tier: Tier) {
  const { x, y, length: l, width: w, angle, high } = m;
  const random = stream(m.seed);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const shaded = nx * LIGHT.x + ny * LIGHT.y < 0 ? 1 : -1;
  const bow = (random() - 0.5) * w * 0.8;
  const taper = 0.25 + 0.5 * random();
  const steps = 18;
  /** The oval's half width a share `s` of the way along it, rounder at one end than the other. */
  const half = (s: number) => {
    const t = Math.abs(2 * s - 1);
    const p = 2 + (s < 0.5 ? taper : 1 - taper) * 1.5;
    return (
      (w / 2) * Math.max(0, 1 - t ** p) ** (1 / p) * (1 + 0.06 * Math.sin(s * 13 + m.seed * 40))
    );
  };
  const at = (s: number, side: number, share: number): [number, number] => {
    const u = l * share * (s - 0.5);
    const v = bow * Math.sin(Math.PI * s) + side * half(s) * share;
    return [x + dx * u + nx * v, y + dy * u + ny * v];
  };
  /** The oval at a share of its size, round from one end along `side` and back. */
  const ring = (share: number): number[] => {
    const points: number[] = [];
    for (let n = 0; n <= steps; n++) points.push(...at(n / steps, 1, share));
    for (let n = steps - 1; n > 0; n--) points.push(...at(n / steps, -1, share));
    return points;
  };
  const ink = INK_KM[tier] * (0.6 + 0.45 * high);
  g.poly(ring(1)).fill({ color: TERRAIN_COLOURS.foldLight, alpha: 0.45 });
  const edge: number[] = [];
  for (let n = 0; n <= steps; n++) edge.push(...at(n / steps, shaded, 1));
  const flank = [...edge];
  for (let n = steps; n >= 0; n--) flank.push(...at(n / steps, shaded, 0.08));
  g.poly(flank).fill({
    color: high > 0.6 ? TERRAIN_COLOURS.foldDeep : TERRAIN_COLOURS.foldShade,
    alpha: 0.85,
  });
  g.poly(ring(0.55)).stroke({
    width: ink * 0.35,
    color: TERRAIN_COLOURS.foldInk,
    alpha: 0.4,
    join: 'round',
  });
  const hatches = tier === 'close' ? 13 : 8;
  for (let n = 0; n < hatches; n++) {
    const s = 0.08 + (0.84 * (n + 0.5)) / hatches;
    const [ax, ay] = at(s, shaded, 0.15);
    const [bx, by] = at(s, shaded, 0.96 - 0.15 * random());
    g.moveTo(ax, ay).lineTo(bx, by);
  }
  g.stroke({ width: ink * 0.4, color: TERRAIN_COLOURS.foldInk, alpha: 0.6, cap: 'round' });
  g.moveTo(edge[0] as number, edge[1] as number);
  for (let n = 2; n < edge.length; n += 2) g.lineTo(edge[n] as number, edge[n + 1] as number);
  g.stroke({ width: ink * 0.75, color: TERRAIN_COLOURS.foldInk, alpha: 0.85, cap: 'round' });
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

const MUD_WALL = mix(PAPER, 0xb3895a, 0.5);
const MUD_ROOF = mix(PAPER, 0xf3e2bd, 0.6);
const MUD_SHADE = mix(PAPER, 0x7a5532, 0.55);

/**
 * A hamlet's houses, smaller and fewer than a village's symbol, drawn in km so they grow
 * with the map. On arid land they are boxes of mud brick with flat roofs, one of them
 * domed; elsewhere they have pitched roofs.
 */
function hamlet(g: GraphicsContext, m: Extract<Mark, { kind: 'hamlet' }>) {
  const random = stream(m.seed);
  const count = m.roofs === 'flat' ? 3 + Math.floor(random() * 3) : 2 + Math.floor(random() * 2);
  const houses = Array.from({ length: count }, (_, n) => {
    const angle = (n / count) * Math.PI * 2 + random() * 0.8;
    const distance = n === 0 ? 0 : 0.8 + 0.45 * random();
    return {
      x: m.x + Math.cos(angle) * distance * 1.2,
      y: m.y + Math.sin(angle) * distance * 0.8,
      w: 0.9 + 0.4 * random(),
      dome: m.roofs === 'flat' && n === 0 && random() < 0.6,
    };
  }).sort((a, b) => a.y - b.y);
  const line = { width: 0.1, color: INK, alpha: 0.85, join: 'round' } as const;
  for (const h of houses) {
    const { x, y, w } = h;
    const left = x - w / 2;
    const right = x + w / 2;
    if (m.roofs === 'flat') {
      const wall = w * 0.5;
      const top = y - wall;
      const back = w * 0.3;
      const lean = w * 0.18;
      g.poly([right, y, right + lean, y - back, right + lean, top - back, right, top]).fill(
        MUD_SHADE,
      );
      g.rect(left, top, w, wall).fill(MUD_WALL);
      g.poly([left, top, right, top, right + lean, top - back, left + lean, top - back]).fill(
        MUD_ROOF,
      );
      g.rect(x - w * 0.08, y - wall * 0.55, w * 0.16, wall * 0.55).fill(INK);
      g.poly([
        left,
        y,
        left,
        top,
        left + lean,
        top - back,
        right + lean,
        top - back,
        right + lean,
        y - back,
        right,
        y,
      ]).stroke(line);
      g.moveTo(left, top).lineTo(right, top).lineTo(right, y).stroke(line);
      if (h.dome) {
        const r = w * 0.24;
        const cx = x + lean * 0.5;
        const cy = top - back * 0.5;
        g.moveTo(cx - r, cy)
          .arc(cx, cy, r, Math.PI, 0)
          .closePath()
          .fill(MUD_ROOF)
          .stroke(line);
      }
    } else {
      const wall = w * 0.55;
      const top = y - wall;
      const peak = top - w * 0.5;
      g.rect(left, top, w, wall).fill(PAPER);
      g.rect(x + w * 0.15, top, w * 0.35, wall).fill(MUD_SHADE);
      g.rect(left, top, w, wall).stroke(line);
      g.poly([left - 0.08, top, x, peak, x, top]).fill(mix(PAPER, 0xa2482a, 0.7));
      g.poly([x, peak, right + 0.08, top, x, top]).fill(mix(INK, 0x8a3b22, 0.4));
      g.poly([left - 0.08, top, x, peak, right + 0.08, top]).stroke(line);
    }
  }
}

/** The ring of spoil round each shaft of a qanat, with the shaft dark in the middle. */
function qanat(g: GraphicsContext, m: Extract<Mark, { kind: 'qanat' }>) {
  for (const [x, y] of m.points) g.circle(x, y, 0.42);
  g.fill(MOUND);
  for (const [x, y] of m.points) g.circle(x, y, 0.42);
  g.stroke({ width: 0.12, color: MOUND_SHADE, alpha: 1 });
  for (const [x, y] of m.points) g.circle(x, y, 0.14);
  g.fill(INK);
}

const STRAW = mix(PAPER, 0xa8893f, 0.62);
const MOUND_LIT = mix(PAPER, 0xfff3d6, 0.35);
const MOUND = mix(PAPER, 0x9c7a46, 0.38);
const MOUND_SHADE = mix(PAPER, 0x6e4f2a, 0.5);

const GROUND_KINDS = ['tuft', 'scrub', 'rock', 'stream', 'tumulus', 'crack'] as const;
type GroundMark = Extract<Mark, { kind: (typeof GROUND_KINDS)[number] }>;

function isGround(m: Mark): m is GroundMark {
  return (GROUND_KINDS as readonly string[]).includes(m.kind);
}

/**
 * The open ground's marks, drawn in one pass by colour: every tuft's blades in one
 * stroke, every bush's crowns, shades, and outlines in one fill or stroke each, and so on.
 * There are thousands of them in a close view, and a drawing call apiece made each redraw
 * of the terrain texture cost three times as much. They seldom overlap, so the order
 * among them does not show. Their lines are as wide at the middle zoom as close up.
 */
function ground(g: GraphicsContext, marks: readonly GroundMark[], tier: Tier) {
  const k = INK_KM[tier] / INK_KM.close;
  const tufts = marks.filter((m) => m.kind === 'tuft');
  const bushes = marks.filter((m) => m.kind === 'scrub');
  const rocks = marks.filter((m) => m.kind === 'rock');
  const streams = marks.filter((m) => m.kind === 'stream');
  const mounds = marks.filter((m) => m.kind === 'tumulus');
  const cracks = marks.filter((m) => m.kind === 'crack');

  for (const m of cracks) {
    const random = stream(m.seed);
    const sides = 5 + Math.floor(random() * 3);
    const turn = random() * Math.PI * 2;
    const points: number[] = [];
    for (let n = 0; n < sides; n++) {
      const a = turn + ((n + (random() - 0.5) * 0.5) / sides) * Math.PI * 2;
      const r = m.size * (0.8 + 0.35 * random());
      points.push(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
    }
    g.poly(points);
  }
  if (cracks.length) {
    g.stroke({ width: 0.15 * k, color: TERRAIN_COLOURS.saltCrack, alpha: 0.85, join: 'round' });
  }

  for (const m of streams) {
    const [first, ...rest] = m.points;
    if (!first) continue;
    g.moveTo(first[0], first[1]);
    for (const [px, py] of rest) g.lineTo(px, py);
  }
  if (streams.length)
    g.stroke({ width: 0.2, color: STREAM, alpha: 0.85, cap: 'round', join: 'round' });

  for (const tone of ['green', 'straw'] as const) {
    const toned = tufts.filter((m) => m.tone === tone);
    for (const m of toned) {
      const random = stream(m.seed);
      const blades = 4 + Math.floor(random() * 3);
      for (let n = 0; n < blades; n++) {
        const a = -Math.PI / 2 + (n / (blades - 1) - 0.5) * 1.5 + (random() - 0.5) * 0.2;
        const length = m.size * (0.55 + 0.45 * random());
        g.moveTo(m.x, m.y).lineTo(m.x + Math.cos(a) * length, m.y + Math.sin(a) * length);
      }
    }
    if (toned.length) {
      g.stroke({ width: 0.16 * k, color: tone === 'green' ? GRASS : STRAW, cap: 'round' });
    }
  }
  for (const m of tufts) g.moveTo(m.x - m.size * 0.35, m.y).lineTo(m.x + m.size * 0.35, m.y);
  if (tufts.length) g.stroke({ width: 0.12 * k, color: GROUND_INK, alpha: 0.6, cap: 'round' });

  const domes = mounds.map((m) => {
    const w = m.size;
    const h = w * 0.34;
    const { x, y } = m;
    return {
      dome: [
        x - w / 2,
        y,
        x - w * 0.32,
        y - h * 0.8,
        x,
        y - h,
        x + w * 0.32,
        y - h * 0.8,
        x + w / 2,
        y,
      ],
      shade: [x, y - h, x + w * 0.32, y - h * 0.8, x + w / 2, y, x + w * 0.05, y],
      lit: [x - w * 0.32, y - h * 0.8, x, y - h, x - w * 0.05, y - h * 0.55],
    };
  });
  for (const d of domes) g.poly(d.dome);
  if (domes.length) g.fill(MOUND);
  for (const d of domes) g.poly(d.shade);
  if (domes.length) g.fill(MOUND_SHADE);
  for (const d of domes) g.poly(d.lit);
  if (domes.length) g.fill(MOUND_LIT);
  for (const d of domes) {
    g.moveTo(d.dome[0] as number, d.dome[1] as number);
    for (let n = 2; n < d.dome.length; n += 2) {
      g.lineTo(d.dome[n] as number, d.dome[n + 1] as number);
    }
  }
  if (domes.length) g.stroke({ width: 0.13 * k, color: INK, alpha: 0.8, join: 'round' });

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
  if (crowns.length) g.stroke({ width: 0.12 * k, color: INK, alpha: 0.75 });

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
  if (shapes.length) g.stroke({ width: 0.13 * k, color: INK, join: 'round' });
}

/** Draws marks of one tier into a new context, in the order given. */
export function drawMarks(marks: readonly Mark[], tier: Tier): GraphicsContext {
  const g = new GraphicsContext();
  // The ground lies flat, under the relief and the trees of its tier.
  const groundMarks = marks.filter(isGround);
  if (groundMarks.length) ground(g, groundMarks, tier);
  for (const m of marks) {
    switch (m.kind) {
      case 'mountain':
        mountain(g, m, tier);
        break;
      case 'fold':
        fold(g, m, tier);
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
      case 'hamlet':
        hamlet(g, m);
        break;
      case 'qanat':
        qanat(g, m);
        break;
      case 'tuft':
      case 'scrub':
      case 'rock':
      case 'stream':
      case 'tumulus':
      case 'crack':
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

/** The white crust of the salt pans, paling from the desert at their rim to salt within. */
export function drawPans(pans: readonly Wood[]): GraphicsContext {
  const g = new GraphicsContext();
  const steps = [
    { r: PAN_RIM * 0.97, color: TERRAIN_COLOURS.saltEdge },
    { r: 1.02, color: TERRAIN_COLOURS.saltRim },
    { r: 0.96, color: TERRAIN_COLOURS.salt },
  ];
  for (const { r, color } of steps) {
    for (const pan of pans) for (const l of pan.lobes) lobe(g, l.x, l.y, l.r * r);
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
