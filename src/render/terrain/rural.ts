import type { Point } from '../../sim/map.ts';
import type { Land, Mark } from './marks.ts';
import { hash01, stream, valueNoise } from './random.ts';
import { scatter, type Rect } from './scatter.ts';

export type RuralMark = Extract<
  Mark,
  { kind: 'channel' | 'wetland' | 'grassland' | 'pastoralCamp' }
>;

function footprint(land: Land, x: number, y: number, radius: number): boolean {
  return [
    [0, 0],
    [-radius, 0],
    [radius, 0],
    [0, -radius],
    [0, radius],
  ].every(([dx = 0, dy = 0]) => land.open(x + dx, y + dy));
}

/** Open, watered dry plains, not a new climate layer or a geographic rectangle. */
function pasture(land: Land, x: number, y: number): boolean {
  if (
    !land.open(x, y) ||
    land.cover(x, y) !== 'dry' ||
    land.desert.inside(x, y) ||
    land.hills.inside(x, y) ||
    land.mountains.distance(x, y) < 24 ||
    land.woodDepth(x, y, 1.2) > 0 ||
    land.cultivated.inside(x, y) ||
    land.valleyAt(x, y)
  )
    return false;
  if (
    land
      .placesNear(x, y, 26)
      .some(
        (place) =>
          Math.hypot(place.x - x, place.y - y) <
          (place.rank === 'capital'
            ? 26
            : place.rank === 'city'
              ? 20
              : place.rank === 'town'
                ? 13
                : 9),
      )
  )
    return false;
  return !land.hamletsNear(x, y, 9).some((place) => Math.hypot(place.x - x, place.y - y) < 7);
}

/** Irrigation branches join actual river geometry, staying in already-watered land. */
function channels(land: Land, rect: Rect): RuralMark[] {
  const marks: RuralMark[] = [];
  for (const { x, y, seed } of scatter(
    rect,
    8,
    1401,
    (x, y) => {
      if (!land.cultivated.inside(x, y) || !land.open(x, y) || land.cleared(x, y, 'close'))
        return undefined;
      const river = land.riverAt(x, y, 24);
      return river && river.distance > 3 ? 18 + 4 * valueNoise(x, y, 30, 1402) : undefined;
    },
    22,
  )) {
    const river = land.riverAt(x, y, 24);
    if (!river) throw new Error('irrigation candidate lost its river');
    const [ax, ay] = river.at;
    const dx = x - ax,
      dy = y - ay;
    const length = Math.hypot(dx, dy);
    const bow = (seed - 0.5) * length * 0.3;
    const steps = Math.ceil(length);
    const points: Point[] = Array.from({ length: steps + 1 }, (_, n) => {
      const t = n / steps;
      const bend = Math.sin(Math.PI * t) * bow;
      return [ax + dx * t - (dy / length) * bend, ay + dy * t + (dx / length) * bend];
    });
    if (
      points.every(
        ([px, py]) =>
          land.open(px, py) &&
          !land.cleared(px, py, 'close') &&
          (land.cultivated.inside(px, py) || land.valleyAt(px, py)),
      )
    )
      marks.push({ kind: 'channel', points });
  }
  return marks;
}

/**
 * The two sparse landscapes gain different human/ecological detail: delta marshes
 * and river-fed canals, versus meadow ribbons and small pastoral camps on dry plains.
 * These are atlas symbols, never settlements, resources, or units in the rules.
 */
export function ruralMarks(land: Land, rect: Rect): RuralMark[] {
  const marks = channels(land, rect);
  for (const { x, y, seed } of scatter(
    rect,
    5,
    1410,
    (x, y) =>
      land.cultivated.inside(x, y) &&
      land.open(x, y) &&
      land.coast.distance(x, y) < 34 &&
      !land.cleared(x, y, 'close')
        ? 10 + 4 * valueNoise(x, y, 23, 1411)
        : undefined,
    14,
  )) {
    const random = stream(seed),
      size = 2 + 2 * random();
    if (footprint(land, x, y, size * 1.5))
      marks.push({ kind: 'wetland', x, y, size, angle: random() * Math.PI, seed });
  }
  for (const { x, y, seed } of scatter(
    rect,
    6,
    1420,
    (x, y) =>
      pasture(land, x, y) && valueNoise(x, y, 48, 1421) > 0.42
        ? 11 + 4 * hash01(Math.floor(x), Math.floor(y), 1422)
        : undefined,
    15,
  )) {
    const random = stream(seed),
      size = 4 + 3 * random();
    const angle = (valueNoise(x, y, 70, 1423) - 0.5) * 1.8 + (random() - 0.5) * 1.2;
    if (footprint(land, x, y, size * 1.5))
      marks.push({ kind: 'grassland', x, y, size, angle, seed });
  }
  for (const { x, y, seed } of scatter(
    rect,
    14,
    1430,
    (x, y) =>
      pasture(land, x, y) && land.riverAt(x, y, 30)
        ? 27 + 8 * valueNoise(x, y, 38, 1431)
        : undefined,
    35,
  )) {
    if (footprint(land, x, y, 7))
      marks.push({ kind: 'pastoralCamp', x, y, angle: seed * Math.PI * 2, seed });
  }
  return marks;
}
