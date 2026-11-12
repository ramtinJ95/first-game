import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import {
  parseMap,
  POWERS,
  TERRAIN_KINDS,
  type GameMap,
  type MultiPolygon,
} from '../../src/sim/map.ts';
import type { ProvinceId } from '../../src/sim/ids.ts';
import { buildMap, landInExtent, MAP_FILE, MAX_CITY_MOVE_KM, serializeMap } from './build-map.ts';
import { readCities, type City } from './cities.ts';
import { COASTAL_MIN_SEA_KM, NEIGHBOUR_MIN_BORDER_KM } from './provinces.ts';
import {
  area,
  boxesOverlap,
  boxOf,
  contains,
  difference,
  distance,
  distanceToBoundary,
  intersection,
  perimeter,
  union,
  xor,
} from './geometry.ts';
import { MIN_CITY_SPACING_KM, MIN_SPACING_KM, quotaOf } from './settlements.ts';
import { loadSources, type Sources } from './sources.ts';
import { DESERT_RIVER_KM, MIN_PEAK_M } from './terrain.ts';

const BUILD_TIMEOUT_MS = 60_000;
/** Rounding a vertex to the 0.1 km grid moves it by at most this, so an edge sweeps this times its length. */
const ROUNDING_KM = 0.071;

let sources: Sources;
let committedText: string;
let map: GameMap;
let land: MultiPolygon;
let landArea: number;

beforeAll(async () => {
  sources = await loadSources();
  committedText = readFileSync(MAP_FILE, 'utf8');
  map = parseMap(JSON.parse(committedText));
  land = landInExtent(sources.land);
  landArea = area(land);
}, BUILD_TIMEOUT_MS);

test(
  'two builds serialize byte for byte the same, and match the committed data/map/map.json',
  () => {
    const cities = readCities();
    const first = serializeMap(buildMap(cities, sources).map);
    const second = serializeMap(buildMap(cities, sources).map);
    expect(second === first, 'second build differs from the first').toBe(true);
    expect(
      first === committedText,
      'data/map/map.json is stale; run npm run build:map and commit it',
    ).toBe(true);
  },
  BUILD_TIMEOUT_MS,
);

test('the map has exactly one province for each city in the list', () => {
  const cityIds = readCities()
    .map((city) => city.id)
    .sort();
  expect(map.provinces.map((province) => province.id).sort()).toEqual(cityIds);
});

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
  'provinces overlap by less than 0.01 % of the land area (bbox-overlapping pairs)',
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
    expect(overlap / landArea).toBeLessThan(0.0001);
  },
  BUILD_TIMEOUT_MS,
);

test(
  'provinces cover the land inside the extent: symmetric difference below 0.02 % of its area, less than any island province',
  () => {
    const covered = union(...map.provinces.map((province) => province.outline));
    expect(area(xor(covered, land)) / landArea).toBeLessThan(0.0002);
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
    expect(() => buildMap(cities, sources)).toThrow(/atlantis/);
  },
  BUILD_TIMEOUT_MS,
);

test(
  'every terrain area has a known kind, a unique kind and name, and lies on the land inside the extent',
  () => {
    const parts = land.map((polygon) => ({ polygon, box: boxOf([polygon]) }));
    const problems = map.terrain.flatMap(({ kind, name, outline }) => {
      const box = boxOf(outline);
      const near = parts.filter((part) => boxesOverlap(part.box, box)).map((part) => part.polygon);
      const off = area(difference(outline, near));
      const bound = ROUNDING_KM * perimeter(outline);
      return off > bound
        ? [`${kind} ${name}: ${off.toFixed(1)} km² off the land, bound ${bound.toFixed(1)}`]
        : [];
    });
    expect(problems).toEqual([]);
    expect(map.terrain.filter(({ kind }) => !TERRAIN_KINDS.includes(kind))).toEqual([]);
    const keys = map.terrain.map(({ kind, name }) => `${kind}/${name}`);
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
  },
  BUILD_TIMEOUT_MS,
);

test.each(TERRAIN_KINDS)(
  '%s areas overlap each other only in slivers that rounding to 0.1 km explains',
  (kind) => {
    const areas = map.terrain.filter((terrain) => terrain.kind === kind);
    const boxes = areas.map((terrain) => boxOf(terrain.outline));
    let overlap = 0;
    let bound = 0;
    areas.forEach((a, i) => {
      areas.slice(i + 1).forEach((b, k) => {
        const [boxA, boxB] = [boxes[i], boxes[i + 1 + k]];
        if (boxA && boxB && boxesOverlap(boxA, boxB)) {
          const shared = intersection(a.outline, b.outline);
          overlap += area(shared);
          bound += ROUNDING_KM * perimeter(shared);
        }
      });
    });
    expect(overlap).toBeLessThanOrEqual(bound);
  },
  BUILD_TIMEOUT_MS,
);

test('there are mountains, hills, desert, forest, and lakes, and the Alps are named', () => {
  for (const kind of TERRAIN_KINDS) {
    expect(
      map.terrain.some((terrain) => terrain.kind === kind),
      kind,
    ).toBe(true);
  }
  expect(map.terrain.some(({ kind, name }) => kind === 'mountains' && name === 'Alps')).toBe(true);
});

test(`desert keeps ${DESERT_RIVER_KM} km from every river, so the river cities lie outside it`, () => {
  const deserts = map.terrain
    .filter((terrain) => terrain.kind === 'desert')
    .map((desert) => ({ outline: desert.outline, box: boxOf(desert.outline) }));
  // The buffer's 16-gons reach cos(π/16) of the distance between their corners.
  const reach = DESERT_RIVER_KM * Math.cos(Math.PI / 16) - ROUNDING_KM;
  const close = map.rivers.flatMap((river) =>
    river.line.flatMap(([x, y]) =>
      deserts
        .filter(
          ({ box }) =>
            x >= box.minX - reach &&
            x <= box.maxX + reach &&
            y >= box.minY - reach &&
            y <= box.maxY + reach,
        )
        .filter(
          ({ outline }) => contains(outline, [x, y]) || distanceToBoundary(outline, [x, y]) < reach,
        )
        .map(() => `${river.name} at ${x},${y}`),
    ),
  );
  expect(close).toEqual([]);
  const inDesert = ['memphis', 'thebai', 'syene', 'babylon'].filter((id) => {
    const city = map.provinces.find((province) => province.id === id)?.city;
    return !city || deserts.some(({ outline }) => contains(outline, city));
  });
  expect(inDesert).toEqual([]);
});

test(`every peak lies on the land inside the extent and is at least ${MIN_PEAK_M} m high`, () => {
  expect(map.peaks.length).toBeGreaterThan(0);
  const wrong = map.peaks
    .filter((peak) => !contains(land, peak.at) || peak.height < MIN_PEAK_M)
    .map((peak) => peak.name);
  expect(wrong).toEqual([]);
});

test('every settlement lies inside its own province and on the land (exact test, no tolerance)', () => {
  expect(map.settlements.length).toBeGreaterThan(0);
  const outlineOf = new Map(map.provinces.map((province) => [province.id, province.outline]));
  const misplaced = map.settlements.flatMap((settlement) => {
    const problems = [];
    if (!contains(outlineOf.get(settlement.province) ?? [], settlement.at)) {
      problems.push(`outside ${settlement.province}`);
    }
    if (!contains(land, settlement.at)) problems.push('off the land');
    return problems.map((problem) => `${settlement.id}: ${problem}`);
  });
  expect(misplaced).toEqual([]);
});

test(`settlements are at least ${MIN_SPACING_KM} km apart and at least ${MIN_CITY_SPACING_KM} km from every city`, () => {
  const crowded = map.settlements.flatMap((settlement, i) => [
    ...map.settlements
      .slice(i + 1)
      .filter((other) => distance(settlement.at, other.at) < MIN_SPACING_KM)
      .map((other) => `${settlement.id} / ${other.id}`),
    ...map.provinces
      .filter((province) => distance(settlement.at, province.city) < MIN_CITY_SPACING_KM)
      .map((province) => `${settlement.id} / city ${province.id}`),
  ]);
  expect(crowded).toEqual([]);
});

test('no province holds more settlements than its quota, and no city is also a settlement', () => {
  const over = map.provinces.flatMap((province) => {
    const count = map.settlements.filter((s) => s.province === province.id).length;
    return count > quotaOf(province.area) ? [`${province.id}: ${count}`] : [];
  });
  expect(over).toEqual([]);
  const cityIds = new Set(map.provinces.map((province) => province.pleiadesId));
  expect(map.settlements.filter((s) => cityIds.has(s.pleiadesId)).map((s) => s.id)).toEqual([]);
});
