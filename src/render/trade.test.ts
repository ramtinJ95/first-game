import { expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import { openTrade } from '../sim/trade/orders.ts';
import { routePoint } from '../sim/trade/routes.ts';
import {
  anchorOutsideTrade,
  MERCHANT_SPACING_KM,
  merchantPoses,
  placeNamesWithGoods,
  tradeCityLabel,
} from './trade.ts';
import { LABEL_PRIORITY, placeLabels } from './labels.ts';
import { buildScene, type Scene, type SceneInput, type Sprite } from './armies/scene.ts';
import { fitCoastalScene, sceneAnchor } from './coastal-ground.ts';
import { groundSpan } from './figures/sheet.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { TradeRouteId } from '../sim/ids.ts';
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
  const { route, previous, state } = setup();
  const old = previous.tradeRoutes[route.id];
  const crossing = (p: number) => merchantPoses(old, route, p, state.day)[0]?.point;
  expect(crossing(0)).toEqual(old && routePoint(old));
  expect(crossing(1)).toEqual(routePoint(route));
  if (!old) throw new Error('missing previous route');
  old.progress = 0.9;
  route.progress = 0;
  route.returning = true;
  expect(crossing(0)).toEqual(routePoint(old));
  expect(crossing(1)).toEqual(routePoint(route));
  route.blocked = 'raid';
  expect(merchantPoses(old, route, 0.5, state.day)).toEqual([]);
});

test('a route shows a merchant every 200 km of its round trip, as many each way', () => {
  const { route, previous, state } = setup();
  const poses = merchantPoses(previous.tradeRoutes[route.id], route, 0.5, state.day);
  expect(poses).toHaveLength(Math.max(1, Math.round((2 * route.km) / MERCHANT_SPACING_KM)));
  const out = poses.filter(({ point }, i) => {
    const next = merchantPoses(previous.tradeRoutes[route.id], route, 0.6, state.day)[i];
    const from = state.cities[route.from]?.position;
    if (!next || !from) throw new Error('missing pose');
    return (
      Math.hypot(next.point.x - from.x, next.point.y - from.y) >
      Math.hypot(point.x - from.x, point.y - from.y)
    );
  });
  expect(Math.abs(out.length - poses.length / 2)).toBeLessThanOrEqual(1);
});

test('a raided route waiting for its replacement shows one merchant at its start', () => {
  const { route, state } = setup();
  route.progress = 0;
  route.departsOn = (state.day + 5) as typeof route.departsOn;
  const poses = merchantPoses(undefined, route, 0.5, state.day);
  expect(poses).toHaveLength(1);
  expect(poses[0]?.point).toEqual(routePoint(route, 0));
});

test.each([1.2, 4])(
  'at scale %s each caravan in view has a drawn cart and two merchants, with dry ground',
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
    const carts = sprites.filter((s) => s.key.startsWith('cart.'));
    expect(carts.length).toBeGreaterThan(0);
    expect(sprites).toHaveLength(3 * carts.length);
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
  expect(sprites.length).toBeGreaterThan(0);
  for (const sprite of sprites) expect(sprite.key).toMatch(/^ship\./);
  expect(scene.wakes).toHaveLength(2 * sprites.length);
});

test('foreign traders outside sight do not appear, while a player partner knows its own caravan', () => {
  const { state, input } = setup('sea');
  const hidden = { ...input.sight, sees: () => false, armies: new Set<never>() };
  state.player = f.syracusaeFaction;
  expect(buildScene({ ...input, sight: hidden }).sprites.filter((s) => s.trade)).toHaveLength(0);
  state.player = f.rome;
  expect(
    buildScene({ ...input, sight: hidden }).sprites.filter((s) => s.trade).length,
  ).toBeGreaterThan(0);
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

test('a merchant with no room at its spot shrinks there rather than joining a distant refugee column', () => {
  const size = 20;
  const half = groundSpan('cart') * size;
  // A strip of road too narrow for a full-size cart, and wide land far away by a refugee column.
  const land = (p: MapPoint) => (Math.abs(p.x) <= 0.8 * half && Math.abs(p.y) < 50) || p.x >= 1000;
  const merchant: Sprite = {
    key: 'cart.0@1',
    x: 0,
    y: 0,
    size,
    mirror: false,
    alpha: 1,
    rotation: 0,
    depth: 0,
    trade: 'trade-1' as TradeRouteId,
  };
  const scene: Scene = {
    height: size,
    sprites: [merchant],
    wakes: [],
    works: [],
    breaches: [],
    battleAnchors: new Map(),
    armyBoxes: new Map(),
  };
  const column = sceneAnchor(buildFixture(), [], [{ x: 1100, y: 0 }], (point) => point);
  const placed = (anchor: (sprite: Sprite) => MapPoint | undefined) => {
    const [sprite] = fitCoastalScene(scene, land, 1, land, anchor).sprites;
    if (!sprite) throw new Error('the merchant was not drawn');
    return sprite;
  };
  const kept = placed(anchorOutsideTrade(column));
  expect(Math.hypot(kept.x, kept.y)).toBeLessThan(13);
  expect(kept.size).toBeLessThan(size);
  expect(placed(column).x).toBeGreaterThan(1000);
});

test('a city whose name with its good finds no spot keeps its plain name', () => {
  const capital = {
    id: 'carthago',
    anchor: { x: 100, y: 100 },
    clearance: { x: 10, y: 10 },
    width: 210,
    plainWidth: 60,
    height: 12,
    priority: LABEL_PRIORITY.capital,
    population: 100,
  };
  const town = { ...capital, id: 'utica', anchor: { x: 100, y: 40 }, width: 40, plainWidth: 20 };
  const view = { width: 200, height: 200 };
  expect(placeLabels([capital], [], view).has('carthago')).toBe(false);
  const { placed, plain } = placeNamesWithGoods([capital, town], [], view);
  expect(placed.get('carthago')?.right ?? Infinity).toBeLessThanOrEqual(view.width);
  expect([...plain]).toEqual(['carthago']);
  expect(placed.has('utica')).toBe(true);
});
