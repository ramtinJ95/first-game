/** A number in [0, 1) that depends only on two integers and a salt, so a place always draws alike. */
export function hash01(x: number, y: number, salt: number): number {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A seeded stream of numbers in [0, 1), for the details of one drawing. */
export function stream(seed: number): () => number {
  let state = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1) over the map plane, with features about `cell` km across. */
export function valueNoise(x: number, y: number, cell: number, salt: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const top = hash01(x0, y0, salt) * (1 - tx) + hash01(x0 + 1, y0, salt) * tx;
  const bottom = hash01(x0, y0 + 1, salt) * (1 - tx) + hash01(x0 + 1, y0 + 1, salt) * tx;
  return top * (1 - ty) + bottom * ty;
}
