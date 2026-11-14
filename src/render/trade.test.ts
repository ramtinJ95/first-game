import { expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import { openTrade } from '../sim/trade/orders.ts';
import { routePoint } from '../sim/trade/routes.ts';
import { tradeCityLabel, tradePose } from './trade.ts';
import { buildScene, type SceneInput } from './armies/scene.ts';
import { sightOf } from '../sim/sight.ts';
import { surfaceAt } from '../sim/world/find-path.ts';
import { screenToMap } from './camera.ts';

const world = fixtureWorld();
function setup(mode: 'land' | 'sea' = 'land') {
  const state = buildFixture();
  expect(
    openTrade(
      state,
      {
        kind: 'openTrade',
        faction: f.rome,
        from: f.roma,
        to: mode === 'land' ? f.capua : f.carthago,
        mode,
      },
      world,
    ),
  ).toBeUndefined();
  const route = Object.values(state.tradeRoutes)[0];
  if (!route) throw new Error('missing trade route');
  route.progress = 0.5;
  const previous = structuredClone(state);
  const old = previous.tradeRoutes[route.id];
  if (old) old.progress -= 1 / route.days;
  const sight = sightOf(state, world, f.rome);
  const input: SceneInput = {
    previous,
    current: state,
    progress: 0.5,
    camera: { centre: routePoint(route), scale: 4 },
    viewport: { width: 1000, height: 700 },
    previousSight: sight,
    sight,
    motion: 3.2,
    now: 7,
    growth: 2,
  };
  return { state, previous, route, input };
}

test('a caravan moves continuously and reaches its endpoint before reversing', () => {
  const { route, previous } = setup();
  const old = previous.tradeRoutes[route.id];
  expect(tradePose(old, route, 0)?.point).toEqual(old && routePoint(old));
  expect(tradePose(old, route, 1)?.point).toEqual(routePoint(route));
  if (!old) throw new Error('missing previous route');
  old.progress = 0.9;
  route.progress = 0;
  route.returning = true;
  expect(tradePose(old, route, 0)?.point).toEqual(routePoint(old));
  expect(tradePose(old, route, 1)?.point).toEqual(routePoint(route));
  route.blocked = 'raid';
  expect(tradePose(old, route, 0.5)).toBeUndefined();
});

test.each([1.2, 4])(
  'at scale %s the caravan has a drawn cart and two merchants, with dry ground',
  (scale) => {
    const { route, input } = setup();
    const camera = { ...input.camera, scale };
    const frame = {
      ...input,
      camera,
      land: (p: { x: number; y: number }) =>
        surfaceAt(world.mesh, screenToMap(camera, input.viewport, p)) === 'land',
    };
    const sprites = buildScene(frame).sprites.filter((s) => s.trade === route.id);
    expect(sprites).toHaveLength(3);
    expect(sprites.some((s) => s.key.startsWith('cart.'))).toBe(true);
    for (const sprite of sprites) expect(frame.land(sprite)).toBe(true);
    const later = buildScene({ ...frame, progress: 0.9 }).sprites.filter(
      (s) => s.trade === route.id,
    );
    expect(later.map((s) => [s.x, s.y])).not.toEqual(sprites.map((s) => [s.x, s.y]));
  },
);

test('a trade ship uses the convoy ink sheet and leaves a wake', () => {
  const { route, input } = setup('sea');
  const scene = buildScene(input);
  const sprites = scene.sprites.filter((s) => s.trade === route.id);
  expect(sprites).toHaveLength(1);
  expect(sprites[0]?.key).toMatch(/^ship\./);
  expect(scene.wakes.length).toBeGreaterThan(0);
});

test('foreign traders outside sight do not appear, while a player partner knows its own caravan', () => {
  const { state, input } = setup('sea');
  const hidden = { ...input.sight, sees: () => false, armies: new Set<never>() };
  state.player = f.syracusaeFaction;
  expect(buildScene({ ...input, sight: hidden }).sprites.filter((s) => s.trade)).toHaveLength(0);
  state.player = f.rome;
  expect(buildScene({ ...input, sight: hidden }).sprites.filter((s) => s.trade)).toHaveLength(1);
});

test('a recent raid leaves a damaged cart at the recorded raid, not the reset origin', () => {
  const { route, state, input } = setup();
  route.blocked = 'raid';
  route.progress = 0;
  route.raid = { on: state.day, position: routePoint(route, 0.5) };
  expect(buildScene(input).sprites.filter((s) => s.trade)).toHaveLength(4);
  const late = { ...state, day: (state.day + 7) as typeof state.day };
  expect(buildScene({ ...input, current: late }).sprites.filter((s) => s.trade)).toHaveLength(0);
});

test('goods join city names only where the existing label layout has room at figure zooms', () => {
  const state = buildFixture();
  const city = state.cities[f.roma];
  if (!city) throw new Error('missing city');
  expect(tradeCityLabel(state, city, 0.5)).toBe('ROMA');
  expect(tradeCityLabel(state, city, 1.2)).toBe('ROMA · grain');
});
