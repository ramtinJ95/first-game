import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { tradeForecast, type TradeMode } from '../sim/trade/routes.ts';
import { distance } from '../sim/world/find-path.ts';
import { buildWorld } from '../sim/world/world.ts';
import { atlasLand } from './atlas-coast.ts';
import { drawnLane, drawnSide } from './drawn-lane.ts';
import { AreaIndex } from './terrain/area-index.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const state = newGame(map, { seed: 1, player: 'rome' });
const land = atlasLand(map);
const capitals = Object.values(state.cities).filter(
  (city) => map.provinces.find((p) => p.id === city.province)?.capital,
);

/**
 * The stretches of a way on the wrong side of the drawn coast, in km, leaving out each
 * end until the way first reaches the drawn side: a harbour of the rules can stand on
 * an islet or a spit the atlas draws.
 */
function crossings(path: readonly MapPoint[], inside: boolean): number[] {
  const { wrong } = drawnSide(land, inside);
  const runs: number[] = [];
  let reached = false;
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as MapPoint;
    const b = path[i] as MapPoint;
    const steps = Math.max(1, Math.ceil(distance(a, b) / 0.1));
    for (let k = 0; k < steps; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      if (!wrong(p)) {
        if (run > 0) runs.push(run);
        reached = true;
        run = 0;
      } else if (reached) run += distance(a, b) / steps;
    }
  }
  return runs;
}

const routes = capitals.flatMap((from) =>
  Object.values(state.cities).flatMap((to) =>
    (['sea', 'land'] as TradeMode[]).flatMap((mode) => {
      if (to.id === from.id) return [];
      const forecast = tradeForecast(state, world, from, to, mode);
      return forecast ? [{ name: `${from.id} to ${to.id} by ${mode}`, mode, forecast }] : [];
    }),
  ),
);

test('the capitals have sea lanes and roads to check', () => {
  expect(routes.filter((r) => r.mode === 'sea').length).toBeGreaterThan(30);
  expect(routes.filter((r) => r.mode === 'land').length).toBeGreaterThan(30);
});

test('a sea lane out of a capital on day 1 crosses no drawn land between its harbours', () => {
  const ashore = routes
    .filter((r) => r.mode === 'sea')
    .flatMap(({ name, forecast }) => {
      const km = crossings(drawnLane(forecast.path, land, false).path, false);
      return km.length > 0 ? [`${name}: ${km.map((k) => k.toFixed(1)).join(', ')} km`] : [];
    });
  expect(ashore).toEqual([]);
});

test('the rules found the Massalia lane over the drawn cape of Corsica, and the drawn lane goes round it', () => {
  const roma = state.cities['roma' as never];
  const massalia = state.cities['massalia' as never];
  if (!roma || !massalia) throw new Error('Roma and Massalia are on the map');
  const forecast = tradeForecast(state, world, roma, massalia, 'sea');
  if (!forecast) throw new Error('Roma trades with Massalia by sea');
  expect(Math.max(...crossings(forecast.path, false))).toBeGreaterThan(1);
  const lane = drawnLane(forecast.path, land, false);
  expect(crossings(lane.path, false)).toEqual([]);
  expect(lane.km).toBeLessThan(forecast.km * 1.1);
});

/**
 * The atlas draws water across the rules' land between Persepolis and the gulf, so the
 * road has no way round on drawn land.
 */
const WADING = new Set(['persepolis to gerrha by land']);

test('a road out of a capital on day 1 crosses drawn water only at fords of under 2 km', () => {
  const wet = routes
    .filter((r) => r.mode === 'land' && !WADING.has(r.name))
    .flatMap(({ name, forecast }) => {
      const km = crossings(drawnLane(forecast.path, land, true).path, true).filter((k) => k >= 2);
      return km.length > 0 ? [`${name}: ${km.map((k) => k.toFixed(1)).join(', ')} km`] : [];
    });
  expect(wet).toEqual([]);
});

test('a lane keeps its ends and the drawn side of a simple coast', () => {
  const square = new AreaIndex(
    [
      [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      ],
    ],
    0,
    { seams: false },
  );
  const path = [
    { x: -5, y: 5 },
    { x: 15, y: 5 },
  ];
  const lane = drawnLane(path, square, false);
  expect(lane.path[0]).toEqual(path[0]);
  expect(lane.path.at(-1)).toEqual(path[1]);
  expect(lane.path.length).toBeGreaterThan(2);
  const { wrong } = drawnSide(square, false);
  for (let i = 1; i < lane.path.length; i++) {
    const a = lane.path[i - 1] as MapPoint;
    const b = lane.path[i] as MapPoint;
    for (let k = 0; k <= 20; k++)
      expect(wrong({ x: a.x + ((b.x - a.x) * k) / 20, y: a.y + ((b.y - a.y) * k) / 20 })).toBe(
        false,
      );
  }
  expect(lane.km).toBeLessThan(20 + 2 * 10 + 1);
});
