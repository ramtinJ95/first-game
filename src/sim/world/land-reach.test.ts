import { expect, test } from 'vitest';
import { fixtureWorld } from '../fixture.ts';
import { MAX_MARCH_DAYS, MARCH_KM_PER_DAY } from '../march.ts';
import { distance, findPath } from './find-path.ts';
import { mayWalkWithin } from './land-reach.ts';

const world = fixtureWorld();
const cities = world.map.provinces.map((p) => ({ id: p.id, at: { x: p.city[0], y: p.city[1] } }));
const marchKm = MAX_MARCH_DAYS * MARCH_KM_PER_DAY;

test.each(cities)('the reach filter preserves every existing affordable road to $id', (to) => {
  for (const from of cities) {
    const path = findPath(world.mesh, from.at, to.at, 'land');
    if (!path) continue;
    let km = 0;
    let at = from.at;
    for (const point of path) {
      km += distance(at, point);
      at = point;
    }
    for (const limit of [1000, marchKm])
      if (km <= limit)
        expect(
          mayWalkWithin(world.mesh, from.at, to.at, limit),
          `${from.id} to ${to.id}, ${km} <= ${limit}`,
        ).toBe(true);
  }
});

test('rejects a road round the Mediterranean before searching its overlong detour', () => {
  const roma = cities.find((c) => c.id === 'roma');
  const iol = cities.find((c) => c.id === 'iol-caesarea');
  if (!roma || !iol) throw new Error('missing cities');
  expect(distance(roma.at, iol.at)).toBeLessThan(marchKm);
  expect(findPath(world.mesh, roma.at, iol.at, 'land')).toBeDefined();
  expect(mayWalkWithin(world.mesh, roma.at, iol.at, marchKm)).toBe(false);
});

test('keeps a zero-length walk and rejects points off land', () => {
  const city = cities[0];
  if (!city) throw new Error('missing city');
  expect(mayWalkWithin(world.mesh, city.at, city.at, 0)).toBe(true);
  expect(mayWalkWithin(world.mesh, { x: -100, y: -100 }, city.at, marchKm)).toBe(false);
});

test.each([-1, NaN, Infinity])('rejects invalid range %s explicitly', (within) => {
  const city = cities[0];
  if (!city) throw new Error('missing city');
  expect(() => mayWalkWithin(world.mesh, city.at, city.at, within)).toThrow(RangeError);
});
