import { readFileSync } from 'node:fs';
import { naturalCoast } from '../src/render/coast.ts';
import { toPixels } from '../src/render/lines.ts';
import { parseMap, type Point, type Ring } from '../src/sim/map.ts';

export function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Longest contiguous shore within 20 m of a single chord, not merely segment length. */
export function straightRun(ring: Ring, closed = true): number {
  let longest = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point,
      run = [a];
    let length = 0;
    for (let n = 1; n < (closed ? ring.length : ring.length - i); n++) {
      const b = ring[(i + n) % ring.length] as Point;
      const previous = run[run.length - 1] as Point;
      length += Math.hypot(b[0] - previous[0], b[1] - previous[1]);
      if (run.some((p) => distance(p, a, b) > 0.02)) break;
      longest = Math.max(longest, length);
      run.push(b);
    }
  }
  return longest;
}

export function coastMetrics() {
  const map = parseMap(
    JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
  );
  const coast = naturalCoast(map);
  let maxDeviationKm = 0;
  for (const [i, source] of map.coastline.entries()) {
    const line = coast.lines[i];
    if (!line) throw new Error(`missing coast ${i}`);
    let n = 0;
    for (let k = 1; k < source.length; k++) {
      const a = source[k - 1] as Point,
        b = source[k] as Point;
      do {
        const point = line[++n];
        if (!point) throw new Error(`missing coast anchor ${i}/${k}`);
        maxDeviationKm = Math.max(maxDeviationKm, distance(point, a, b));
      } while (line[n]?.[0] !== b[0] || line[n]?.[1] !== b[1]);
    }
  }
  const drawn = coast.lines.map((line) => {
    const flat = toPixels(line, 4, 0.75);
    return Array.from({ length: flat.length / 2 }, (_, n): Point => [
      (flat[n * 2] as number) / 4,
      (flat[n * 2 + 1] as number) / 4,
    ]);
  });
  return {
    coastlines: map.coastline.length,
    controlPoints: map.coastline.flat().length,
    detailedPoints: coast.lines.flat().length,
    maxDeviationKm,
    longestStraightBeforeKm: Math.max(...map.coastline.map((line) => straightRun(line, false))),
    longestStraightAfterKm: Math.max(...coast.lines.map((line) => straightRun(line, false))),
    longestStraightDrawnAfterKm: Math.max(...drawn.map((line) => straightRun(line, false))),
    chordToleranceKm: 0.02,
    closestScale: 4,
  };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(coastMetrics(), null, 2));
