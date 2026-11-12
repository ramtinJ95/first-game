/**
 * Figure art as an ordered list of SVG paint operations, painted from the back of the
 * picture to the front. A fill is either a fixed colour or a shade of the owner's
 * colour, so one list paints every faction.
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** Shades of the owner's colour. `base` is the colour itself, after the tint. */
export type FactionShade = 'light' | 'base' | 'shade' | 'deep';

/** How bright each shade is, as a grey that multiplies the faction's colour. */
export const SHADE_GREY: Readonly<Record<FactionShade, number>> = {
  light: 0xffffff,
  base: 0xd6d6d6,
  shade: 0xa4a4a4,
  deep: 0x787878,
};

export type Fill = string | { readonly faction: FactionShade };

export interface PaintOp {
  readonly d: string;
  readonly fill?: Fill;
  /** An ink outline of this width in figure units. */
  readonly stroke?: number;
  readonly strokeColour?: string;
  readonly cap?: 'round' | 'butt';
  readonly opacity?: number;
}

export const INK = '#3b2816';

export const n = (value: number) => (Math.round(value * 10) / 10).toString();

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** A unit vector at `degrees` from straight down, turning towards +x (forward). */
export function dir(degrees: number): Vec {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** The point `length` from `from` in the direction `degrees` from straight down. */
export const reach = (from: Vec, degrees: number, length: number): Vec =>
  add(from, scale(dir(degrees), length));

export function polygon(points: readonly Vec[]): string {
  return `M${points.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`;
}

export function polyline(points: readonly Vec[]): string {
  return `M${points.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}`;
}

/** A smooth closed outline through the points, as Catmull-Rom curves. */
export function smoothClosed(points: readonly Vec[]): string {
  const count = points.length;
  const at = (i: number) => points[((i % count) + count) % count] as Vec;
  let d = `M${n(at(0).x)} ${n(at(0).y)}`;
  for (let i = 0; i < count; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return `${d}Z`;
}

/** A smooth open line through the points. */
export function smoothOpen(points: readonly Vec[]): string {
  const count = points.length;
  const at = (i: number) => points[Math.max(0, Math.min(count - 1, i))] as Vec;
  let d = `M${n(at(0).x)} ${n(at(0).y)}`;
  for (let i = 0; i < count - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return d;
}

/** A limb from `a` to `b` that tapers from radius `ra` to `rb`, with round ends. */
export function capsule(a: Vec, b: Vec, ra: number, rb: number): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 0.001;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const nx = -uy;
  const ny = ux;
  const p = (c: Vec, r: number, side: number) =>
    `${n(c.x + nx * r * side)} ${n(c.y + ny * r * side)}`;
  return (
    `M${p(a, ra, 1)}L${p(b, rb, 1)}` +
    `A${n(rb)} ${n(rb)} 0 0 0 ${p(b, rb, -1)}` +
    `L${p(a, ra, -1)}` +
    `A${n(ra)} ${n(ra)} 0 0 0 ${p(a, ra, 1)}Z`
  );
}

export function circle(c: Vec, r: number): string {
  return `M${n(c.x - r)} ${n(c.y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

/** An ellipse with radii `rx`, `ry`, turned by `degrees`. */
export function ellipse(c: Vec, rx: number, ry: number, degrees = 0, steps = 24): string {
  const r = (degrees * Math.PI) / 180;
  const points: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    points.push({
      x: c.x + x * Math.cos(r) - y * Math.sin(r),
      y: c.y + x * Math.sin(r) + y * Math.cos(r),
    });
  }
  return polygon(points);
}

/** Points on an ellipse from `from` to `to` radians of its own angle. */
export function arcPoints(
  c: Vec,
  rx: number,
  ry: number,
  degrees: number,
  from: number,
  to: number,
  steps = 12,
): Vec[] {
  const r = (degrees * Math.PI) / 180;
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    points.push({
      x: c.x + x * Math.cos(r) - y * Math.sin(r),
      y: c.y + x * Math.sin(r) + y * Math.cos(r),
    });
  }
  return points;
}

const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

function shadeOf(shade: FactionShade, colour: number): string {
  const k = (SHADE_GREY[shade] & 0xff) / 255;
  const channel = (shift: number) => Math.round(((colour >> shift) & 0xff) * k) << shift;
  return hex(channel(16) | channel(8) | channel(0));
}

/** The figure's paint as SVG, its faction fills in `colour`. */
export function paintSvg(ops: readonly PaintOp[], colour: number): string {
  return ops
    .map((op) => {
      const fill =
        op.fill === undefined
          ? 'none'
          : typeof op.fill === 'string'
            ? op.fill
            : shadeOf(op.fill.faction, colour);
      const parts = [`d="${op.d}"`, `fill="${fill}"`];
      if (op.opacity !== undefined) parts.push(`opacity="${n(op.opacity)}"`);
      if (op.stroke) {
        parts.push(
          `stroke="${op.strokeColour ?? INK}"`,
          `stroke-width="${n(op.stroke)}"`,
          `stroke-linejoin="round"`,
          `stroke-linecap="${op.cap ?? 'round'}"`,
        );
      }
      return `<path ${parts.join(' ')}/>`;
    })
    .join('');
}
