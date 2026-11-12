/**
 * When a kind of drawing shows, in pixels per km. It fades in from `in[0]` to `in[1]`
 * and, when it has an `out`, fades out from `out[0]` to `out[1]`. The widest zoom on a
 * 1280 px view is about 0.17 and the closest is 4.
 */
export interface Band {
  readonly in: readonly [number, number];
  readonly out?: readonly [number, number];
}

export const DETAIL = {
  /** Desert ground, forest ground, and lakes show at every zoom. */
  ground: { in: [0, 0] },
  /** Large mountains and hills that make each range read as a range. */
  reliefWide: { in: [0, 0], out: [0.66, 0.92] },
  /** Small tree marks in the woods, and dunes and stipple in the deserts, at the regional zoom. */
  textureWide: { in: [0.26, 0.4], out: [0.66, 0.92] },
  /** Single mountains and hills of the middle zoom, with trees, dunes, stipple, and the named peaks. */
  reliefMiddle: { in: [0.66, 0.92], out: [1.75, 2.4] },
  /** Small mountains and hills of the close zoom, with hatched shading. */
  reliefClose: { in: [1.75, 2.4] },
  /** Named peaks stand out with the middle relief, and their names show at a close zoom. */
  peakNames: { in: [1.4, 1.9] },
  towns: { in: [0.75, 1.05] },
  townNames: { in: [1.5, 2] },
  villages: { in: [1.7, 2.3] },
  villageNames: { in: [2.7, 3.3] },
  /** Fields, orchards, and tracks around every settled place. */
  fields: { in: [2.2, 3] },
  /** Smoke over the cities and boats off the ports. */
  life: { in: [2.2, 3] },
} as const satisfies Record<string, Band>;

export type DetailName = keyof typeof DETAIL;

function ramp(scale: number, [from, to]: readonly [number, number]): number {
  if (scale <= from) return 0;
  if (scale >= to) return 1;
  const t = (scale - from) / (to - from);
  return t * t * (3 - 2 * t);
}

/**
 * How strongly a band shows at `scale`, from 0 to 1. A fade in rises faster than a fade
 * out falls, so where one tier hands over to the next both stay strong and the land
 * never looks washed out between them.
 */
export function detailAlpha(band: Band, scale: number): number {
  const shown = band.in[1] <= 0 ? 1 : Math.sqrt(ramp(scale, band.in));
  return band.out ? shown * Math.sqrt(1 - ramp(scale, band.out)) : shown;
}
