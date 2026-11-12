import { hash01 } from './random.ts';

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Scattered {
  readonly x: number;
  readonly y: number;
  /** The spacing the point keeps from its neighbours, in km. */
  readonly radius: number;
  /** A seed in [0, 1) for the drawing's own details. */
  readonly seed: number;
}

/**
 * Scatters points over `rect` with no grid in the result. Each cell of a fine lattice
 * holds one candidate at a hashed spot with a hashed priority. `radiusAt` says how far
 * apart points must stand there, or `undefined` where none may stand. A candidate
 * stays when no valid candidate of higher priority stands within the mean of their two
 * radii. That rule reads only nearby cells, so any two rects that share ground pick
 * the same points on it, and chunks drawn apart meet with no seam.
 */
export function scatter(
  rect: Rect,
  cell: number,
  salt: number,
  radiusAt: (x: number, y: number) => number | undefined,
  widest: number,
): Scattered[] {
  const reach = Math.ceil(widest / cell);
  const i0 = Math.floor(rect.left / cell);
  const j0 = Math.floor(rect.top / cell);
  const i1 = Math.ceil(rect.right / cell) - 1;
  const j1 = Math.ceil(rect.bottom / cell) - 1;
  const width = i1 - i0 + 1 + 2 * reach;
  const size = width * (j1 - j0 + 1 + 2 * reach);
  const xs = new Float64Array(size);
  const ys = new Float64Array(size);
  const radii = new Float64Array(size);
  const priorities = new Float64Array(size);
  const known = new Uint8Array(size);
  /** Fills the candidate of cell `i`, `j` and returns its slot. A radius of 0 means none. */
  const candidate = (i: number, j: number): number => {
    const key = (j - j0 + reach) * width + (i - i0 + reach);
    if (known[key] === 0) {
      const x = (i + hash01(i, j, salt)) * cell;
      const y = (j + hash01(i, j, salt + 1)) * cell;
      xs[key] = x;
      ys[key] = y;
      radii[key] = radiusAt(x, y) ?? 0;
      priorities[key] = hash01(i, j, salt + 2);
      known[key] = 1;
    }
    return key;
  };
  const kept: Scattered[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const own = candidate(i, j);
      const radius = radii[own] as number;
      const x = xs[own] as number;
      const y = ys[own] as number;
      const priority = priorities[own] as number;
      if (radius === 0) continue;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
      let wins = true;
      for (let dj = -reach; dj <= reach && wins; dj++) {
        for (let di = -reach; di <= reach; di++) {
          if (di === 0 && dj === 0) continue;
          const other = candidate(i + di, j + dj);
          const otherRadius = radii[other] as number;
          if (otherRadius === 0 || (priorities[other] as number) < priority) continue;
          const gap = (radius + otherRadius) / 2;
          const dx = (xs[other] as number) - x;
          const dy = (ys[other] as number) - y;
          if (dx * dx + dy * dy < gap * gap) {
            wins = false;
            break;
          }
        }
      }
      if (wins) kept.push({ x, y, radius, seed: hash01(i, j, salt + 3) });
    }
  }
  return kept;
}
