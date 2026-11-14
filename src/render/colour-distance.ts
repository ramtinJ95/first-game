/** CIE76 ΔE in D65 Lab, from sRGB. 10 is a deliberately visible, not just JND, floor. */
export function colourDistance(a: number, b: number): number {
  const lab = (colour: number) => {
    const [r, g, blue] = [16, 8, 0].map((shift) => {
      const c = ((colour >> shift) & 255) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 841) / 108 + 4 / 29);
    const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * blue) / 0.95047);
    const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * blue);
    const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * blue) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
  };
  const x = lab(a),
    y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The same normal-alpha composition as the map's wash sprite. */
export function washTint(ground: number, wash: number, alpha: number): number {
  return [16, 8, 0].reduce((out, shift) => {
    const a = (ground >> shift) & 255;
    const b = (wash >> shift) & 255;
    return out | (Math.round(a + (b - a) * alpha) << shift);
  }, 0);
}
