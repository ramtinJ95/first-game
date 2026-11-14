import type { MapLine, MultiPolygon, Point } from '../sim/map.ts';

/** The weights of the border's ink in screen px, which the line takes in turn like a pen. */
export const BORDER_WEIGHTS = [0.65, 0.85, 1.05] as const;
/** A run of one weight is between these many km long. */
const RUN_KM = { shortest: 6, longest: 22 } as const;

/** One stretch of border drawn at one of BORDER_WEIGHTS. */
export interface BorderRun {
  readonly weight: number;
  readonly line: MapLine;
}

function edgeKey([ax, ay]: Point, [bx, by]: Point): string {
  const a = `${ax},${ay}`;
  const b = `${bx},${by}`;
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * The borders between provinces, each drawn once: the edges two outlines share, joined
 * into lines that end where three provinces or the coast meet. The coast is drawn apart.
 */
export function sharedBorders(map: {
  readonly provinces: readonly { readonly outline: MultiPolygon }[];
}): MapLine[] {
  const uses = new Map<string, number>();
  const ends = new Map<string, [Point, Point]>();
  for (const { outline } of map.provinces) {
    for (const ring of outline.flat()) {
      for (const [k, a] of ring.entries()) {
        const b = ring[(k + 1) % ring.length] as Point;
        const key = edgeKey(a, b);
        uses.set(key, (uses.get(key) ?? 0) + 1);
        ends.set(key, [a, b]);
      }
    }
  }
  const next = new Map<string, { point: Point; edge: string }[]>();
  const pointOf = new Map<string, Point>();
  for (const [key, count] of uses) {
    if (count !== 2) continue;
    const [a, b] = ends.get(key) as [Point, Point];
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const at = `${from}`;
      pointOf.set(at, from);
      next.set(at, [...(next.get(at) ?? []), { point: to, edge: key }]);
    }
  }
  const walked = new Set<string>();
  const lines: MapLine[] = [];
  const walk = (start: string) => {
    for (const first of next.get(start) ?? []) {
      if (walked.has(first.edge)) continue;
      const line: Point[] = [pointOf.get(start) as Point];
      let step: { point: Point; edge: string } | undefined = first;
      while (step && !walked.has(step.edge)) {
        walked.add(step.edge);
        line.push(step.point);
        const onward: { point: Point; edge: string }[] = next.get(`${step.point}`) ?? [];
        step = onward.length === 2 ? onward.find((o) => !walked.has(o.edge)) : undefined;
      }
      lines.push(line);
    }
  };
  for (const [at, onward] of next) if (onward.length !== 2) walk(at);
  for (const at of next.keys()) walk(at);
  return lines;
}

function hash(a: number, b: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Cuts each border into runs of a seeded length in km, each with a seeded weight, so the
 * ink thickens and thins along the line as a pen's does, the same at every zoom.
 */
export function borderRuns(lines: readonly MapLine[]): BorderRun[] {
  const runs: BorderRun[] = [];
  for (const [index, line] of lines.entries()) {
    let run = 0;
    let points: Point[] = [line[0] as Point];
    let left = RUN_KM.shortest + (RUN_KM.longest - RUN_KM.shortest) * hash(index, 0);
    const close = () => {
      const weight = BORDER_WEIGHTS[Math.floor(hash(index, run + 1) * BORDER_WEIGHTS.length)];
      runs.push({ weight: weight ?? BORDER_WEIGHTS[1], line: points });
      run++;
      points = [points[points.length - 1] as Point];
      left = RUN_KM.shortest + (RUN_KM.longest - RUN_KM.shortest) * hash(index, run + 1000);
    };
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1] as Point;
      const b = line[k] as Point;
      points.push(b);
      left -= Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (left <= 0 && k < line.length - 1) close();
    }
    if (points.length >= 2) close();
  }
  return runs;
}
