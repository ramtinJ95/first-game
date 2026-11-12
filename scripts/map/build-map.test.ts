import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import {
  parseMap,
  POWERS,
  type GameMap,
  type MultiPolygon,
  type ProvinceId,
} from '../../src/sim/map.ts';
import { buildMap, landInExtent, MAP_FILE, MAX_CITY_MOVE_KM, serializeMap } from './build-map.ts';
import { readCities, type City } from './cities.ts';
import { COASTAL_MIN_SEA_KM, NEIGHBOUR_MIN_BORDER_KM } from './provinces.ts';
import { area, boxesOverlap, boxOf, contains, intersection, union, xor } from './geometry.ts';
import { loadNaturalEarth, type NaturalEarth } from './sources.ts';

const BUILD_TIMEOUT_MS = 60_000;

let naturalEarth: NaturalEarth;
let committedText: string;
let map: GameMap;
let land: MultiPolygon;
let landArea: number;

beforeAll(async () => {
  naturalEarth = await loadNaturalEarth();
  committedText = readFileSync(MAP_FILE, 'utf8');
  map = parseMap(JSON.parse(committedText));
  land = landInExtent(naturalEarth.land);
  landArea = area(land);
}, BUILD_TIMEOUT_MS);

test(
  'two builds serialize byte for byte the same, and match the committed data/map/map.json',
  () => {
    const cities = readCities();
    const first = serializeMap(buildMap(cities, naturalEarth.land, naturalEarth.rivers).map);
    const second = serializeMap(buildMap(cities, naturalEarth.land, naturalEarth.rivers).map);
    expect(second === first, 'second build differs from the first').toBe(true);
    expect(
      first === committedText,
      'data/map/map.json is stale; run npm run build:map and commit it',
    ).toBe(true);
  },
  BUILD_TIMEOUT_MS,
);

test('every city lies inside its own province, in no other, and on the land (exact test, no tolerance)', () => {
  const misplaced = map.provinces.flatMap((province) => {
    const problems = [];
    if (!contains(province.outline, province.city)) problems.push('outside its own province');
    if (!contains(land, province.city)) problems.push('off the land');
    for (const other of map.provinces) {
      if (other !== province && contains(other.outline, province.city)) {
        problems.push(`inside ${other.id}`);
      }
    }
    return problems.map((problem) => `${province.id}: ${problem}`);
  });
  expect(misplaced).toEqual([]);
});

test(`every province has a land neighbour (border >= ${NEIGHBOUR_MIN_BORDER_KM} km) or is an island, and islands have none`, () => {
  const stranded = map.provinces
    .filter((province) => province.neighbours.length > 0 === province.island)
    .map(({ id, island, neighbours }) => ({ id, island, neighbours }));
  expect(stranded).toEqual([]);
});

test('neighbours are symmetric', () => {
  const neighboursOf = new Map(map.provinces.map((province) => [province.id, province.neighbours]));
  const oneSided = map.provinces.flatMap((province) =>
    province.neighbours
      .filter((other) => !neighboursOf.get(other)?.includes(province.id))
      .map((other) => `${province.id} -> ${other}`),
  );
  expect(oneSided).toEqual([]);
});

test('neighbouring outlines touch: they share at least one vertex on the 0.1 km grid', () => {
  const vertices = new Map(
    map.provinces.map((province) => [
      province.id,
      new Set(province.outline.flat(2).map(([x, y]) => `${x},${y}`)),
    ]),
  );
  const apart = map.provinces.flatMap((province) =>
    province.neighbours
      .filter((other) => {
        const mine = vertices.get(province.id) ?? new Set<string>();
        return ![...(vertices.get(other) ?? [])].some((vertex) => mine.has(vertex));
      })
      .map((other) => `${province.id} / ${other}`),
  );
  expect(apart).toEqual([]);
});

test(
  'provinces overlap by less than 0.1 % of the land area (bbox-overlapping pairs)',
  () => {
    const boxes = map.provinces.map((province) => boxOf(province.outline));
    let overlap = 0;
    map.provinces.forEach((a, i) => {
      map.provinces.slice(i + 1).forEach((b, k) => {
        const [boxA, boxB] = [boxes[i], boxes[i + 1 + k]];
        if (boxA && boxB && boxesOverlap(boxA, boxB)) {
          overlap += area(intersection(a.outline, b.outline));
        }
      });
    });
    expect(overlap / landArea).toBeLessThan(0.001);
  },
  BUILD_TIMEOUT_MS,
);

test(
  'provinces cover the land inside the extent: symmetric difference below 0.5 % of its area',
  () => {
    const covered = union(...map.provinces.map((province) => province.outline));
    expect(area(xor(covered, land)) / landArea).toBeLessThan(0.005);
  },
  BUILD_TIMEOUT_MS,
);

test('the five great capitals exist, are flagged capital, and start with their power', () => {
  const capitals = Object.fromEntries(
    map.provinces
      .filter((province) => province.capital)
      .map((province) => [province.name, province.owner]),
  );
  expect(capitals).toEqual({
    Roma: 'rome',
    Carthago: 'carthage',
    Pella: 'macedon',
    Alexandria: 'egypt',
    Persepolis: 'persia',
  });
});

test('each great power starts with one set of provinces connected by land', () => {
  const neighboursOf = new Map(map.provinces.map((province) => [province.id, province.neighbours]));
  for (const power of POWERS) {
    const held = map.provinces.filter((p) => p.owner === power).map((p) => p.id);
    const reached = new Set<ProvinceId>(held.slice(0, 1));
    for (const id of reached) {
      for (const next of neighboursOf.get(id) ?? []) if (held.includes(next)) reached.add(next);
    }
    expect([...reached].sort(), `${power} provinces reachable from ${held[0]}`).toEqual(
      [...held].sort(),
    );
  }
});

test(`every port province is coastal (at least ${COASTAL_MIN_SEA_KM} km of sea-facing border)`, () => {
  const landlocked = map.provinces.filter((p) => p.port && !p.coastal).map((p) => p.id);
  expect(landlocked).toEqual([]);
});

test(
  `the build fails when a city lies more than ${MAX_CITY_MOVE_KM} km from land`,
  () => {
    const atSea: City = {
      id: 'atlantis',
      name: 'Atlantis',
      pleiadesId: 1,
      lon: 18,
      lat: 34,
      owner: 'independent',
      capital: false,
      port: true,
    };
    const cities = [...readCities(), atSea];
    expect(() => buildMap(cities, naturalEarth.land, naturalEarth.rivers)).toThrow(/atlantis/);
  },
  BUILD_TIMEOUT_MS,
);
