import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseMap, type GameMap, type MultiPolygon, type Point } from '../../src/sim/map.ts';
import { landOutline } from '../../src/render/land-outline.ts';
import { naturalCoast } from '../../src/render/coast.ts';
import { coastKey } from '../../src/render/coast-key.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import {
  area,
  contains,
  difference,
  distanceToBoundary,
  intersection,
  simplify,
  union,
} from './geometry.ts';
import { landInExtent } from './build-map.ts';
import { mapPlane } from './projection.ts';
import { loadDrawingLand, SOURCES } from './sources.ts';

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

export async function buildDrawingCoast() {
  const map = parseMap(JSON.parse(readFileSync('data/map/map.json', 'utf8')));
  const plane = mapPlane();
  const physical = landOutline(map);
  const inherited = simplify(naturalCoast(map).land, 0.08);
  const source = landInExtent(await loadDrawingLand());
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
  // Uninhabited offshore islands are atlas scenery, not new provinces. Omit specks
  // below half a square kilometre; larger missing land would require a rules-map change.
  const scenery = fine.filter((polygon) => {
    const size = area([polygon]);
    return size >= 0.5 && size <= 100 && intersection([polygon], physical).length === 0;
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
      if (
        distanceToBoundary([[map.extent]], mid) <= 0.15 ||
        distanceToBoundary(frameEdges, mid) <= 0.025
      ) {
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
      return intersection([decoded], physical).length === 0 ? [p] : [];
    }),
    land,
    runs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildDrawingCoast();
  writeFileSync('data/map/drawing-coast.json', JSON.stringify(result) + '\n');
  console.log(`${result.land.length} land pieces, ${result.land.flat(2).length} outline points`);
}
