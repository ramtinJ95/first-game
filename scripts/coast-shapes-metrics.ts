import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseMap, type Point } from '../src/sim/map.ts';
import { atlasCoast } from '../src/render/atlas-coast.ts';
import { naturalCoast } from '../src/render/coast.ts';
import { landInExtent } from './map/build-map.ts';
import { loadDrawingLand } from './map/sources.ts';
import { mapPlane } from './map/projection.ts';
import { distanceToBoundary } from './map/geometry.ts';
import drawing from '../data/map/drawing-coast.json' with { type: 'json' };
import { toPixels } from '../src/render/lines.ts';
import { COAST_VIEWS } from '../e2e/coast-views.ts';

const CELL = 16;
export const SAMPLE_KM = 0.25;
type Edge = readonly [Point, Point];

export class CoastDistance {
  readonly cells = new Map<string, Edge[]>();
  constructor(lines: Point[][]) {
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as Point,
          b = line[i] as Point;
        for (
          let x = Math.floor(Math.min(a[0], b[0]) / CELL);
          x <= Math.floor(Math.max(a[0], b[0]) / CELL);
          x++
        )
          for (
            let y = Math.floor(Math.min(a[1], b[1]) / CELL);
            y <= Math.floor(Math.max(a[1], b[1]) / CELL);
            y++
          ) {
            const key = `${x},${y}`;
            const edges = this.cells.get(key) ?? [];
            edges.push([a, b]);
            this.cells.set(key, edges);
          }
      }
  }
  nearest(p: Point): { distance: number; point: Point } {
    const cx = Math.floor(p[0] / CELL),
      cy = Math.floor(p[1] / CELL);
    let distance = Infinity,
      point: Point = [NaN, NaN];
    for (let ring = 0; ring < 1024; ring++) {
      for (let x = cx - ring; x <= cx + ring; x++)
        for (let y = cy - ring; y <= cy + ring; y++) {
          if (ring && x !== cx - ring && x !== cx + ring && y !== cy - ring && y !== cy + ring)
            continue;
          for (const [a, b] of this.cells.get(`${x},${y}`) ?? []) {
            const dx = b[0] - a[0],
              dy = b[1] - a[1];
            const t = Math.max(
              0,
              Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
            );
            const q: Point = [a[0] + t * dx, a[1] + t * dy];
            const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (d < distance) {
              distance = d;
              point = q;
            }
          }
        }
      const unseen = Math.min(
        p[0] - (cx - ring) * CELL,
        (cx + ring + 1) * CELL - p[0],
        p[1] - (cy - ring) * CELL,
        (cy + ring + 1) * CELL - p[1],
      );
      if (distance <= unseen) return { distance, point };
    }
    throw new Error(`No coastline near ${p}`);
  }
}

export function* coastSamples(lines: Point[][], spacing = SAMPLE_KM): Generator<Point> {
  for (const line of lines) {
    if (!line.length) continue;
    yield line[0] as Point;
    let next = spacing;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point,
        b = line[i] as Point;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length === 0) continue;
      while (next <= length) {
        yield [a[0] + ((b[0] - a[0]) * next) / length, a[1] + ((b[1] - a[1]) * next) / length];
        next += spacing;
      }
      next -= length;
    }
    yield line[line.length - 1] as Point;
  }
}

function compare(lines: Point[][], to: CoastDistance, within: (p: Point) => boolean = () => true) {
  const distances: number[] = [];
  let max = -1,
    worst: Point = [0, 0],
    nearest: Point = [0, 0];
  for (const p of coastSamples(lines)) {
    if (!within(p)) continue;
    const hit = to.nearest(p);
    distances.push(hit.distance);
    if (hit.distance > max) {
      max = hit.distance;
      worst = p;
      nearest = hit.point;
    }
  }
  distances.sort((a, b) => a - b);
  if (!distances.length) throw new Error('No coast samples in the requested view');
  const plane = mapPlane();
  return {
    samples: distances.length,
    medianKm: distances[Math.floor(distances.length / 2)],
    p95Km: distances[Math.floor(distances.length * 0.95)],
    maxSampleKm: max,
    continuousUpperBoundKm: max + SAMPLE_KM / 2,
    worst: { at: worst, lonlat: plane.toLonLat(worst), nearest },
  };
}

export async function coastShapeMetrics() {
  const map = parseMap(JSON.parse(readFileSync('data/map/map.json', 'utf8')));
  const after = atlasCoast(map).lines;
  const sourceLand = landInExtent(await loadDrawingLand());
  const frame = mapPlane().extent;
  const reference: Point[][] = [];
  for (const ring of sourceLand.flat()) {
    let current: Point[] = [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length] as Point;
      if (distanceToBoundary([[frame]], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) <= 0.15) {
        if (current.length > 1) reference.push(current);
        current = [];
      } else {
        if (!current.length) current.push(a);
        current.push(b);
      }
    });
    if (current.length > 1) reference.push(current);
  }
  const real = new CoastDistance(reference),
    physical = new CoastDistance(map.coastline);
  const art = new CoastDistance(after),
    before = naturalCoast(map).lines;
  const inhabitedPoints = new Set(
    atlasCoast(map).land.flatMap((polygon, p) =>
      drawing.scenery.includes(p) ? [] : polygon.flat(),
    ),
  );
  const shared = after.filter((line) => inhabitedPoints.has(line[0] as Point));
  const scenery = after.filter((line) => !inhabitedPoints.has(line[0] as Point));
  const inkAt = (scale: number, lines: Point[][]) =>
    lines.map((line) => {
      const pixels = toPixels(line, scale, 0.75);
      return Array.from({ length: pixels.length / 2 }, (_, n): Point => [
        (pixels[n * 2] as number) / scale,
        (pixels[n * 2 + 1] as number) / scale,
      ]);
    });
  return {
    sampleSpacingKm: SAMPLE_KM,
    source: 'Natural Earth 1:10m land, ca96624a56bd078437bca8184e78163e5039ad19, public domain',
    drawnBeforeToSource: compare(before, real),
    drawnAfterToSource: compare(after, real),
    sourceToBefore: compare(reference, new CoastDistance(before)),
    sourceToAfter: compare(reference, art),
    drawnToPhysical: compare(after, physical),
    sharedCoastToPhysical: compare(shared, physical),
    sceneryToPhysical: compare(scenery, physical),
    physicalToDrawn: compare(map.coastline, art),
    ink: [4, 1, 0.66].map((scale) => ({
      scale,
      sharedCoastToPhysical: compare(inkAt(scale, shared), physical),
      drawnToSource: compare(inkAt(scale, after), real),
    })),
    regions: COAST_VIEWS.map(({ name, at, scale }) => {
      const within = ([x, y]: Point) =>
        Math.abs(x - at.x) <= 640 / scale && Math.abs(y - at.y) <= 360 / scale;
      return {
        name,
        scale,
        beforeToSource: compare(scale >= 1.75 ? before : map.coastline, real, within),
        afterToSource: compare(after, real, within),
      };
    }),
    physicalPoints: map.coastline.flat().length,
    drawingPoints: after.flat().length,
    landPieces: atlasCoast(map).land.length,
    sceneryPieces: drawing.scenery.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await coastShapeMetrics();
  writeFileSync('docs/evidence/coast-shapes-metrics.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
