import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseMap, type GameMap, type MultiPolygon, type Point } from '../../src/sim/map.ts';
import { landOutline } from '../../src/render/land-outline.ts';
import { AreaIndex } from '../../src/render/terrain/area-index.ts';
import { naturalCoast } from '../../src/render/coast.ts';
import { coastKey } from '../../src/render/coast-key.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import {
  area,
  boxesOverlap,
  boxOf,
  contains,
  cropToBox,
  difference,
  intersection,
  nearBoundary,
  simplify,
  union,
} from './geometry.ts';
import { landInExtent } from './build-map.ts';
import { mapPlane } from './projection.ts';
import { loadDrawingLand, SOURCES, type LonLatPolygon } from './sources.ts';

export const DRAWING_TOLERANCE_KM = 0.1;
export const COAST_BAND_KM = 8;
export const DRAWING_UNIT_KM = 0.025;
const CIRCLE_SIDES = 24;

function circle([x, y]: Point, radius: number): MultiPolygon {
  return [
    [
      Array.from({ length: CIRCLE_SIDES }, (_, i): Point => {
        const angle = (i * 2 * Math.PI) / CIRCLE_SIDES;
        return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
      }),
    ],
  ];
}

function combine(parts: MultiPolygon[]): MultiPolygon {
  if (parts.length === 0) return [];
  if (parts.length === 1)
    return (parts[0] as MultiPolygon).map((polygon) =>
      polygon.map((ring) =>
        ring.map(([x, y]): Point => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
      ),
    );
  const half = Math.ceil(parts.length / 2);
  return union(combine(parts.slice(0, half)), combine(parts.slice(half)));
}

/** The entire continuous physical coast, not just its vertices, has an 8 km band. */
function coastalBand(lines: Point[][]): MultiPolygon {
  const pieces = lines.flatMap((line) =>
    line.flatMap((a, i): MultiPolygon[] => {
      const b = line[i + 1];
      if (!b) return [circle(a, COAST_BAND_KM)];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (-(b[1] - a[1]) * COAST_BAND_KM) / length;
      const ny = ((b[0] - a[0]) * COAST_BAND_KM) / length;
      return [
        circle(a, COAST_BAND_KM),
        [
          [
            [
              [a[0] + nx, a[1] + ny],
              [b[0] + nx, b[1] + ny],
              [b[0] - nx, b[1] - ny],
              [a[0] - nx, a[1] - ny],
            ],
          ],
        ],
      ];
    }),
  );
  return combine(pieces);
}

function frameLines(map: GameMap): Point[][] {
  const seaEdges = new Set(
    map.coastline.flatMap((line) =>
      line
        .slice(1)
        .flatMap((b, i) => [
          `${line[i]?.join(',')} ${b.join(',')}`,
          `${b.join(',')} ${line[i]?.join(',')}`,
        ]),
    ),
  );
  return landOutline(map)
    .flat()
    .flatMap((ring) =>
      ring.flatMap((a, i): Point[][] => {
        const b = ring[(i + 1) % ring.length] as Point;
        return seaEdges.has(`${a.join(',')} ${b.join(',')}`) ? [] : [[a, b]];
      }),
    );
}

/** Builds the drawing coast from `drawingLand`, the finer land `loadDrawingLand` reads. */
export function buildDrawingCoast(drawingLand: LonLatPolygon[]) {
  const map = parseMap(JSON.parse(readFileSync('data/map/map.json', 'utf8')));
  const plane = mapPlane();
  const physical = landOutline(map);
  const inherited = simplify(naturalCoast(map).land, 0.08);
  const source = landInExtent(drawingLand);
  const fine = simplify(source, DRAWING_TOLERANCE_KM);
  const world = buildWorld(map);
  // A fixed physical coast wins at inhabited ground and navigable bottlenecks.
  const protections = [
    ...map.provinces.map((p) => ({ name: p.name, at: p.city, radius: 6 })),
    ...[...world.harbours].map(([name, at]) => ({
      name: `harbour:${name}`,
      at: [at.x, at.y] as Point,
      radius: 8,
    })),
    ...[
      { name: 'Bosporus', lonlat: [29.05, 41.12] as Point, radius: 26 },
      { name: 'Hellespont', lonlat: [26.5, 40.18] as Point, radius: 40 },
      { name: 'Messina', lonlat: [15.6, 38.15] as Point, radius: 20 },
      { name: 'Gades crossing', lonlat: [-5.6, 35.95] as Point, radius: 24 },
    ].map(({ name, lonlat, radius }) => ({ name, at: plane.toPlane(lonlat), radius })),
  ];
  const physicalFrame = frameLines(map);
  const protectedArea = union(
    combine(protections.map(({ at, radius }) => circle(at, radius))),
    coastalBand(physicalFrame),
  );
  const physicalIndex = new AreaIndex([physical], 0, { seams: false });
  const physicalParts = physical.map((polygon) => ({ polygon, box: boxOf([polygon]) }));
  const physicalEdges = physical.flatMap((polygon) =>
    polygon.flatMap((ring) =>
      ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length] as Point;
        return [
          Math.min(a[0], b[0]),
          Math.max(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[1], b[1]),
        ] as const;
      }),
    ),
  );
  /**
   * Whether a polygon shares no area with the physical land. A polygon none of whose
   * points is inside it, and whose box no physical edge enters, lies wholly outside it;
   * only the others are clipped.
   */
  const apart = (polygon: MultiPolygon[number]): boolean => {
    const points = polygon.flat();
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    const [left, right, top, bottom] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    if (
      points.some(([x, y]) => physicalIndex.inside(x, y)) ||
      physicalEdges.some(([l, r, t, b]) => l <= right && r >= left && t <= bottom && b >= top)
    ) {
      const box = { minX: left, maxX: right, minY: top, maxY: bottom };
      const near = physicalParts.filter((part) => boxesOverlap(part.box, box));
      return (
        intersection(
          [polygon],
          cropToBox(
            near.map((part) => part.polygon),
            box,
          ),
        ).length === 0
      );
    }
    return true;
  };
  // Uninhabited offshore islands are atlas scenery, not new provinces. Omit specks
  // below half a square kilometre; larger missing land would require a rules-map change.
  const scenery = fine.filter((polygon) => {
    const size = area([polygon]);
    return size >= 0.5 && size <= 100 && apart(polygon);
  });
  const band = coastalBand(map.coastline);
  const snap = (area: MultiPolygon): MultiPolygon =>
    area.map((polygon) =>
      polygon.map((ring) =>
        ring.map(([x, y]): Point => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
      ),
    );
  const packed = union(
    snap(difference(physical, band)),
    snap(difference(intersection(fine, band), protectedArea)),
    snap(intersection(inherited, protectedArea)),
    ...map.provinces
      .filter((p) => !contains(inherited, p.city))
      .map((p) => intersection(physical, circle(p.city, 1))),
    scenery,
  ).map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]): Point => [
        Math.round(x / DRAWING_UNIT_KM),
        Math.round(y / DRAWING_UNIT_KM),
      ]),
    ),
  );
  // Packing can invert a sub-cell inlet. Resolve those contacts in integer space
  // before tracing rings rather than shipping self-intersecting drawing geometry.
  const land = union(packed);
  const runs: [number, number, number][] = [];
  const frameEdges: MultiPolygon = physicalFrame.map((line) => [line]);
  const nearExtent = nearBoundary([[map.extent]], 0.15);
  const nearFrame = nearBoundary(frameEdges, 0.025);
  for (const [r, ring] of land.flat().entries()) {
    let start: number | undefined;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Point,
        b = ring[(i + 1) % ring.length] as Point;
      const mid: Point = [
        ((a[0] + b[0]) / 2) * DRAWING_UNIT_KM,
        ((a[1] + b[1]) / 2) * DRAWING_UNIT_KM,
      ];
      // Physical extent controls are rounded to 100 m. The 10 m edge detector used
      // before that rounding would mistake parts of the atlas frame for sea coast.
      if (nearExtent(mid) || nearFrame(mid)) {
        if (start !== undefined) runs.push([r, start, i]);
        start = undefined;
      } else {
        start ??= i;
      }
    }
    if (start !== undefined) runs.push([r, start, ring.length]);
  }
  return {
    physicalKey: coastKey(map),
    source: SOURCES.drawingLand,
    toleranceKm: DRAWING_TOLERANCE_KM,
    unitKm: DRAWING_UNIT_KM,
    bandKm: COAST_BAND_KM,
    protections,
    frameProtectionKm: COAST_BAND_KM,
    scenery: land.flatMap((polygon, p) => {
      const decoded = polygon.map((ring) =>
        ring.map(([x, y]): Point => [x * DRAWING_UNIT_KM, y * DRAWING_UNIT_KM]),
      );
      return apart(decoded) ? [p] : [];
    }),
    // Each ring is one flat list of every point's step from the one before, which gzip halves.
    land: land.map((polygon) =>
      polygon.map((ring) =>
        ring.flatMap(([x, y], i) => {
          const [px, py] = i === 0 ? [0, 0] : (ring[i - 1] as Point);
          return [x - px, y - py];
        }),
      ),
    ),
    runs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = buildDrawingCoast(await loadDrawingLand());
  writeFileSync('data/map/drawing-coast.json', JSON.stringify(result) + '\n');
  console.log(
    `${result.land.length} land pieces, ${result.land.flat(2).length / 2} outline points`,
  );
}
