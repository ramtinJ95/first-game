import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { parseMap, type GameMap, type Province } from './map.ts';

const committed: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../data/map/map.json'), 'utf8'),
);

test('parseMap accepts the committed map and returns its data unchanged', () => {
  expect(parseMap(committed)).toEqual(committed);
});

const first = (map: GameMap) => map.provinces[0] as Province;

test.each<[string, (map: GameMap) => void, RegExp]>([
  ['a newer version', (map) => Object.assign(map, { version: 2 }), /^map\.version:/],
  [
    'an unknown owner',
    (map) => Object.assign(first(map), { owner: 'atlantis' }),
    /^map\.provinces\[0\]\.owner: unknown owner atlantis/,
  ],
  [
    'a neighbour that is not a province',
    (map) => first(map).neighbours.push('atlantis' as Province['id']),
    /unknown province atlantis/,
  ],
  [
    'a ring of two points',
    (map) =>
      first(map).outline[0]?.splice(0, 1, [
        [0, 0],
        [1, 1],
      ]),
    /^map\.provinces\[0\]\.outline\[0\]\[0\]: expected at least 3 points/,
  ],
  [
    'a coordinate that is not a number',
    (map) => Object.assign(first(map), { city: [1, '2'] }),
    /^map\.provinces\[0\]\.city\[1\]: expected a finite number/,
  ],
  [
    'a province without an outline',
    (map) => Object.assign(first(map), { outline: undefined }),
    /^map\.provinces\[0\]\.outline: expected an array/,
  ],
  [
    'a province without an area',
    (map) => Reflect.deleteProperty(first(map), 'area'),
    /^map\.provinces\[0\]\.area: Invalid key/,
  ],
  [
    'a duplicate province id',
    (map) => map.provinces.push(structuredClone(first(map))),
    /duplicate id/,
  ],
])('parseMap rejects %s and names the field', (_, breakIt, message) => {
  const broken = structuredClone(parseMap(committed));
  breakIt(broken);
  expect(() => parseMap(broken)).toThrow(message);
});

test('parseMap rejects input that is not a map object', () => {
  expect(() => parseMap([])).toThrow(/^map: expected an object/);
});
