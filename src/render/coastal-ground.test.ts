import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { COAST_VIEWS } from '../../e2e/coast-views.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { expectConsistent } from '../sim/references.ts';
import {
  allocateId,
  type ArmyId,
  type BattleId,
  type CityId,
  type ConvoyId,
  type RefugeeColumnId,
} from '../sim/ids.ts';
import type { Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { buildWorld } from '../sim/world/world.ts';
import { locate } from '../sim/world/find-path.ts';
import { changeCityOwner } from '../sim/cities.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import { movement } from '../sim/systems/movement.ts';
import { drawnColumns, fitColumnMarker } from './columns.ts';
import { atlasLand } from './atlas-coast.ts';
import { buildScene, type Scene, type Sprite } from './armies/scene.ts';
import { mapToScreen, screenToMap, symbolGrowth } from './camera.ts';
import {
  coastalSurface,
  fitBanner,
  fitCoastalScene,
  fitPlace,
  groundFits,
  PLACE_REACH_KM,
  sceneAnchor,
} from './coastal-ground.ts';
import { drawnArmies } from './markers.ts';
import { tick } from '../sim/tick.ts';
import { cityDrawingView, fitCitySymbol } from './symbols.ts';
import type { CityRank } from '../sim/state/city.ts';
import type { Day } from '../sim/state/day.ts';
import { Land } from './terrain/marks.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);

test('a real Alexandria to Pelusium evacuation cart stays on land below the figure tier', () => {
  const state = newGame(map, { seed: 1, player: 'egypt' });
  expect(
    executeOrder(
      state,
      {
        kind: 'evacuate',
        faction: state.player,
        city: 'alexandria' as CityId,
        to: 'pelusium' as CityId,
        share: 0.1,
      },
      world,
    ),
  ).toBeUndefined();
  for (let day = 0; day < 17; day++) movement(state);
  const previous = structuredClone(state);
  movement(state);
  const columns = drawnColumns(previous, state, 0.23, seeAll(state));
  const column = columns[0];
  if (!column) throw new Error('missing evacuation column');
  expect(physical.open(column.position.x, column.position.y)).toBe(true);
  expect(drawn.inside(column.position.x, column.position.y)).toBe(false);
  const original = JSON.stringify(state);
  for (const scale of [0.61, 0.75, 0.89]) {
    const camera = { centre: column.position, scale };
    const land = coastalSurface(
      () => drawn,
      (p) => screenToMap(camera, viewport, p),
      physical.land,
    );
    const cart = fitColumnMarker(mapToScreen(camera, viewport, column.position), land, scale);
    for (let i = -11; i <= 11; i += 0.02)
      expect(land({ x: cart.x + i * cart.growth, y: cart.y + 1.6 * cart.growth })).toBe(true);
  }
  expect(JSON.stringify(state)).toBe(original);
  expectConsistent(state);
});
const world = buildWorld(map);
const physical = new Land(map);
const drawn = atlasLand(map);
const viewport = { width: 1280, height: 720 };

test.each([0.6, 0.66, 1, 4])(
  'all city ranks stand on complete dry ground contacts at %s px/km',
  (scale) => {
    const state = newGame(map, { seed: 1, player: 'rome' });
    const original = JSON.stringify(state);
    const contacts: Record<CityRank, { halfWidth: number; y: number }> = {
      capital: { halfWidth: 16.6, y: 9 },
      greatPowerCity: { halfWidth: 11.1, y: 7 },
      minorCity: { halfWidth: 7.1, y: 6 },
    };
    const wet: string[] = [];
    let carthagoMoved = false;
    for (const city of Object.values(state.cities)) {
      const camera = { centre: city.position, scale };
      const land = coastalSurface(
        () => drawn,
        (p) => screenToMap(camera, viewport, p),
        physical.land,
      );
      for (const rank of Object.keys(contacts) as CityRank[]) {
        const at = mapToScreen(camera, viewport, city.position);
        let fitted;
        try {
          fitted = fitCitySymbol(at, rank, land, scale);
        } catch (cause) {
          throw new Error(`${city.name}/${rank}/${scale} has no city contact`, { cause });
        }
        if (city.id === 'carthago' && scale === 4 && rank === 'capital')
          carthagoMoved = fitted.x !== at.x || fitted.y !== at.y;
        const { halfWidth, y } = contacts[rank];
        expect(fitted.growth).toBe(symbolGrowth(scale));
        const steps = Math.ceil(halfWidth * fitted.growth * 8);
        for (let row = -0.6; row <= 0.6; row += 0.1)
          for (let i = 0; i <= steps; i++) {
            const point = {
              x: fitted.x + (-halfWidth + (2 * halfWidth * i) / steps) * fitted.growth,
              y: fitted.y + (y + row) * fitted.growth,
            };
            if (!land(point)) wet.push(`${city.name}/${rank}/${scale}: ${point.x},${point.y}`);
          }
      }
    }
    if (scale === 4) expect(carthagoMoved).toBe(true);
    expect(wet).toEqual([]);
    expect(JSON.stringify(state)).toBe(original);
  },
);

test.each([
  [0.6, 1.5],
  [1.5, 2.5],
  [2.5, 3.5],
  [3.5, 4.01],
])('city contacts remain placeable throughout zooms %s to %s', (from, to) => {
  const state = newGame(map, { seed: 1, player: 'rome' });
  for (let sample = from; sample < to; sample += 0.05) {
    const scale = Math.round(sample * 100) / 100;
    for (const city of Object.values(state.cities)) {
      const camera = { centre: city.position, scale };
      const land = coastalSurface(
        () => drawn,
        (p) => screenToMap(camera, viewport, p),
        physical.land,
      );
      const fitted = fitCitySymbol(
        mapToScreen(camera, viewport, city.position),
        city.rank,
        land,
        scale,
      );
      expect(fitted.growth, `${city.name}/${scale}`).toBe(symbolGrowth(scale));
    }
  }
});

test('damaged and burning Carthago effects follow its displayed city, without moving rules or sight boundaries', () => {
  const state = newGame(map, { seed: 1, player: 'rome' });
  const id = 'carthago' as CityId;
  const city = state.cities[id];
  if (!city) throw new Error('missing Carthago');
  city.walls *= 0.5;
  city.fellOn = state.day;
  city.sackedOn = (state.day - 1) as Day;
  const original = JSON.stringify(state);
  const camera = { centre: city.position, scale: 4 };
  const land = coastalSurface(
    () => drawn,
    (p) => screenToMap(camera, viewport, p),
    physical.land,
  );
  const at = mapToScreen(camera, viewport, city.position);
  const fitted = fitCitySymbol(at, city.rank, land, 4);
  const position = (c: { id: CityId; position: MapPoint }) =>
    c.id === id ? screenToMap(camera, viewport, fitted) : c.position;
  const sight = { ...seeAll(state), armies: new Set<ArmyId>(), sees: () => true };
  const view = cityDrawingView(state, sight, position);
  const input = {
    previous: state,
    current: state,
    progress: 0.5,
    camera,
    viewport,
    previousSight: sight,
    sight,
    growth: symbolGrowth(4),
    motion: 0,
    now: 0,
  };
  const before = buildScene(input);
  const after = fitCoastalScene(
    buildScene({
      ...input,
      previous: view.state,
      current: view.state,
      previousSight: view.sight,
      sight: view.sight,
    }),
    land,
    4,
  );
  const breach = after.breaches.find((b) => b.city === id);
  expect(breach?.x).toBeCloseTo(fitted.x, 9);
  expect(breach?.y).toBeCloseTo(fitted.y, 9);
  expect(breach?.growth).toBe(fitted.growth);
  expect(before.sprites.length).toBeGreaterThan(4);
  expect(after.sprites).toHaveLength(before.sprites.length);
  for (const [i, sprite] of after.sprites.entries()) {
    const was = before.sprites[i];
    if (!was) throw new Error('missing city effect');
    expect(sprite.key).toBe(was.key);
    expect(sprite.x - was.x).toBeCloseTo(fitted.x - at.x);
    expect(sprite.y - was.y).toBeCloseTo(fitted.y - at.y);
    expect(sprite.size).toBe(was.size);
  }
  for (const visible of [false, true]) {
    const edgeSight = {
      ...sight,
      sees: (p: MapPoint) => (p === city.position ? visible : !visible),
    };
    const edgeView = cityDrawingView(state, edgeSight, position);
    const drawnCity = edgeView.state.cities[id];
    if (!drawnCity) throw new Error('missing displayed Carthago');
    expect(edgeView.sight.sees(drawnCity.position)).toBe(visible);
  }
  expect(JSON.stringify(state)).toBe(original);
});

function sceneWith(sprite: Sprite): Scene {
  return {
    height: 54,
    sprites: [sprite],
    wakes: [],
    works: [],
    breaches: [],
    armyBoxes: new Map(),
    battleAnchors: new Map(),
  };
}
const sprite: Sprite = {
  key: 'spearmen.stand.0@0',
  x: 20,
  y: 0,
  size: 54,
  mirror: false,
  alpha: 1,
  rotation: 0,
  depth: 0,
  army: 'a' as ArmyId,
  hit: { left: 0, top: -54, right: 40, bottom: 0 },
};

test('a displaced contact is fitted rather than hidden, and hit boxes move with it without changing the input', () => {
  const land = (p: MapPoint) => p.x >= 40;
  const before = sceneWith(sprite);
  before.armyBoxes.set('a' as ArmyId, sprite.hit as NonNullable<Sprite['hit']>);
  const saved = JSON.stringify(before);
  expect(groundFits(sprite, land)).toBe(false);
  const after = fitCoastalScene(before, land, 4);
  const placed = after.sprites[0] as Sprite;
  expect(after.sprites).toHaveLength(1);
  expect(placed.key).toBe(sprite.key);
  expect(groundFits(placed, land)).toBe(true);
  expect(placed.hit?.left).toBeCloseTo(
    placed.x + (((sprite.hit?.left ?? 0) - sprite.x) * placed.size) / sprite.size,
  );
  expect(after.armyBoxes.get('a' as ArmyId)).toEqual(placed.hit);
  expect(JSON.stringify(before)).toBe(saved);
});

test('an over-wide ship reduces its symbol in a narrow channel instead of disappearing or standing on land', () => {
  const ship = { ...sprite, key: 'ship.0@0', x: 0, size: 48 };
  const land = (p: MapPoint) => Math.abs(p.x) >= 2;
  const after = fitCoastalScene(sceneWith(ship), land, 4);
  expect(after.sprites).toHaveLength(1);
  const placed = after.sprites[0] as Sprite;
  expect(placed.size).toBeLessThan(ship.size);
  expect(groundFits(placed, land)).toBe(true);
});

test('an impossible surface is an explicit failure, never a hidden figure', () => {
  expect(() => fitCoastalScene(sceneWith(sprite), () => false, 4)).toThrow(
    'No safe drawing surface',
  );
});

test('an unowned battlefield victory standard is still grounded, unlike its taller rooftop counterpart', () => {
  const flag = { ...sprite, key: 'standard.0@0', army: undefined, size: 54 * 1.3 };
  const land = (p: MapPoint) => p.x >= 40;
  const placed = fitCoastalScene(sceneWith(flag), land, 4).sprites[0];
  expect(placed).not.toBe(flag);
  expect(placed && groundFits(placed, land)).toBe(true);
});

function seeAll(state: GameState): Sight {
  return {
    faction: state.player,
    provinces: new Set(),
    circles: [],
    armies: new Set(Object.keys(state.armies) as ArmyId[]),
    convoys: new Set(Object.keys(state.convoys) as ConvoyId[]),
    refugeeColumns: new Set(Object.keys(state.refugeeColumns) as RefugeeColumnId[]),
    battles: new Set(Object.keys(state.battles) as BattleId[]),
    sees: () => true,
  };
}

function near(at: MapPoint, surface: 'land' | 'sea'): MapPoint {
  for (let radius = 0; radius <= 100; radius += 0.5)
    for (let k = 0; k < 24; k++) {
      const angle = (k * Math.PI) / 12;
      const p = { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius };
      if (locate(world.mesh, p, surface) < 0) continue;
      if (surface === 'land' && !physical.open(p.x, p.y)) continue;
      return p;
    }
  throw new Error(`No ${surface} near ${JSON.stringify(at)}`);
}

test.each(COAST_VIEWS.filter((v) => !v.name.endsWith('middle')))(
  'armies, refugee carts and convoy hulls keep their surface at $title, middle and closest zoom',
  ({ at, name }) => {
    const state = newGame(map, { seed: 1, player: 'rome' });
    const army = Object.values(state.armies).find((a) => a.owner === state.player);
    if (!army) throw new Error('missing opening Roman army');
    const shipId = allocateId(state, 'army');
    const formations = army.formations.map((id) => {
      const formation = state.formations[id];
      if (!formation) throw new Error(`missing formation ${id}`);
      const fresh = allocateId(state, 'formation');
      state.formations[fresh] = { ...formation, id: fresh, army: shipId };
      return fresh;
    });
    const shipArmy = { ...army, id: shipId, formations };
    state.armies[shipId] = shipArmy;
    const landPoint = near(at, 'land'),
      seaPoint = near(at, 'sea');
    army.activity = { kind: 'idle', position: landPoint };
    const convoy = 'coast-convoy' as ConvoyId;
    shipArmy.activity = { kind: 'embarked', convoy };
    state.convoys[convoy] = {
      id: convoy,
      owner: shipArmy.owner,
      armies: [shipArmy.id],
      position: seaPoint,
      waypoints: [{ x: seaPoint.x + 1, y: seaPoint.y }],
    };
    expectConsistent(state);
    const original = JSON.stringify(state);
    for (const scale of [1, 4]) {
      const camera = { centre: at, scale };
      const onPhysicalLand = (p: MapPoint) => {
        const q = screenToMap(camera, viewport, p);
        return physical.open(q.x, q.y);
      };
      const toMap = (p: MapPoint) => screenToMap(camera, viewport, p);
      const onDrawnLand = coastalSurface(() => drawn, toMap);
      const onWalkable = coastalSurface(() => drawn, toMap, physical.land);
      const raw = buildScene({
        previous: state,
        current: state,
        progress: 0.5,
        camera,
        viewport,
        previousSight: seeAll(state),
        sight: seeAll(state),
        motion: 3.2,
        now: 7.1,
        growth: symbolGrowth(scale),
        land: onPhysicalLand,
      });
      // Exercise the very same refugee/cart art at this field location without
      // inventing a column whose road from Roma illegally crosses the open sea.
      const foot = mapToScreen(camera, viewport, landPoint);
      for (const key of ['cart.0@0', 'refugeeWoman.stand.0@0'])
        raw.sprites.push({ ...sprite, ...foot, key, size: raw.height, depth: foot.y });
      expect(
        raw.sprites.some((s) => s.army === army.id),
        `${name}/${scale} army`,
      ).toBe(true);
      expect(
        raw.sprites.some((s) => s.key.startsWith('ship.')),
        `${name}/${scale} convoy`,
      ).toBe(true);
      expect(
        raw.sprites.some((s) => s.key.startsWith('cart.')),
        `${name}/${scale} refugee cart`,
      ).toBe(true);
      const safe = fitCoastalScene(raw, onDrawnLand, scale, onWalkable, (s) =>
        s.key.startsWith('ship.') ? mapToScreen(camera, viewport, seaPoint) : undefined,
      );
      expect(safe.sprites).toHaveLength(raw.sprites.length);
      for (const s of safe.sprites) {
        expect(groundFits(s, onDrawnLand), `${name}/${scale}/${s.key}`).toBe(true);
        if (!s.key.startsWith('ship.'))
          expect(groundFits(s, onWalkable), `${name}/${scale}/${s.key} walkable`).toBe(true);
      }
    }
    expect(JSON.stringify(state)).toBe(original);
    expectConsistent(state);
  },
);

test('a banner sailing from Roma to Carthago keeps to land inland and to the sea offshore', () => {
  const start = newGame(map, { seed: 1, player: 'rome' });
  const army = Object.values(start.armies).find((a) => a.owner === start.player);
  if (!army) throw new Error('Rome has no army');
  const order = {
    kind: 'embark',
    faction: start.player,
    army: army.id,
    to: 'carthago' as CityId,
  } as const;
  const departure: [GameState, GameState] = [start, tick(start, [order], world).state];
  let landing: [GameState, GameState] | undefined;
  let previous = departure[1];
  for (let day = 0; day < 120 && !landing; day++) {
    const current = tick(previous, [], world).state;
    if (
      previous.armies[army.id]?.activity.kind === 'embarked' &&
      current.armies[army.id]?.activity.kind !== 'embarked'
    )
      landing = [previous, current];
    previous = current;
  }
  if (!landing) throw new Error('the convoy never landed');
  expect(departure[0].armies[army.id]?.activity.kind).not.toBe('embarked');
  expect(departure[1].armies[army.id]?.activity.kind).toBe('embarked');
  expect(landing[0].armies[army.id]?.activity.kind).toBe('embarked');
  expect(landing[1].armies[army.id]?.activity.kind).not.toBe('embarked');
  const original = JSON.stringify([departure, landing]);
  for (const [name, [previous, current]] of [
    ['departure', departure],
    ['landing', landing],
  ] as const) {
    const surfaces = new Set<string>();
    for (const scale of [0.6, 1, 4])
      for (let progress = 0; progress <= 1; progress += 0.05) {
        const banner = drawnArmies(previous, current, progress).find((a) => a.id === army.id);
        if (!banner) throw new Error(`the army has no banner on its ${name} day`);
        const camera = { centre: banner.position, scale };
        const toMap = (p: MapPoint) => screenToMap(camera, viewport, p);
        const drawnLand = coastalSurface(() => drawn, toMap);
        const walkable = coastalSurface(() => drawn, toMap, physical.land);
        const fitted = fitBanner(
          banner,
          previous,
          current,
          physical.land,
          mapToScreen(camera, viewport, banner.position),
          drawnLand,
          scale,
          walkable,
        );
        const ashore = physical.land.inside(banner.position.x, banner.position.y);
        expect(ashore ? walkable(fitted) : !drawnLand(fitted)).toBe(true);
        surfaces.add(ashore ? 'land' : 'sea');
        expectWholeSceneFits(previous, current, progress, camera);
      }
    expect([name, ...[...surfaces].sort()]).toEqual([name, 'land', 'sea']);
    expectConsistent(current);
  }
  expect(JSON.stringify([departure, landing])).toBe(original);
});

test('an army the rules march into Lake Van stands where they put it, as on the lake shore', () => {
  let previous = newGame(map, { seed: 1, player: 'persia' });
  const army = Object.values(previous.armies).find((a) => a.owner === previous.player);
  if (!army) throw new Error('Persia has no army');
  const to = { x: 5017, y: 2696.4 };
  expect(physical.lakes.inside(to.x, to.y)).toBe(true);
  let current = tick(
    previous,
    [{ kind: 'moveArmy', faction: previous.player, army: army.id, to }],
    world,
  ).state;
  for (let day = 0; day < 120 && current.armies[army.id]?.activity.kind !== 'idle'; day++) {
    previous = current;
    current = tick(previous, [], world).state;
  }
  const activity = current.armies[army.id]?.activity;
  if (activity?.kind !== 'idle') throw new Error('the army never arrived');
  expect(Math.hypot(activity.position.x - to.x, activity.position.y - to.y)).toBeLessThan(1);
  for (const scale of [0.6, 1, 4]) {
    const camera = { centre: activity.position, scale };
    const toMap = (p: MapPoint) => screenToMap(camera, viewport, p);
    const at = mapToScreen(camera, viewport, activity.position);
    const fitted = fitBanner(
      { id: army.id, position: activity.position },
      current,
      current,
      physical.land,
      at,
      coastalSurface(() => drawn, toMap),
      scale,
      coastalSurface(() => drawn, toMap, physical.land),
    );
    expect(fitted).toEqual(at);
  }
  expectConsistent(current);
});

/** Builds and fits a whole scene as the renderer does, and checks every visible sprite's ground. */
function expectWholeSceneFits(
  previous: GameState,
  current: GameState,
  progress: number,
  camera: { centre: MapPoint; scale: number },
) {
  const { scale } = camera;
  const toMap = (p: MapPoint) => screenToMap(camera, viewport, p);
  const toScreen = (p: MapPoint) => mapToScreen(camera, viewport, p);
  const drawnLand = coastalSurface(() => drawn, toMap);
  const walkable = coastalSurface(() => drawn, toMap, physical.land);
  const banners = drawnArmies(previous, current, progress).map((army) => ({
    id: army.id,
    position: toMap(
      fitBanner(
        army,
        previous,
        current,
        physical.land,
        toScreen(army.position),
        drawnLand,
        scale,
        walkable,
      ),
    ),
  }));
  const columns = drawnColumns(previous, current, progress, seeAll(current));
  const raw = buildScene({
    previous,
    current,
    progress,
    camera,
    viewport,
    previousSight: seeAll(previous),
    sight: seeAll(current),
    growth: symbolGrowth(scale),
    motion: 0,
    now: 0,
    land: (p) => {
      const at = toMap(p);
      return physical.open(at.x, at.y);
    },
  });
  const scene = fitCoastalScene(
    raw,
    drawnLand,
    scale,
    walkable,
    sceneAnchor(
      current,
      banners,
      columns.map((column) => column.position),
      toScreen,
    ),
  );
  for (const sprite of scene.sprites) {
    if (sprite.alpha <= 0.05) continue;
    if (sprite.key.startsWith('ship.')) expect(groundFits(sprite, drawnLand)).toBe(true);
    else expect(groundFits(sprite, walkable)).toBe(true);
  }
  return { raw, scene };
}

test('refugees from Roma to Massalia, trailing back over the sea, stand on land', () => {
  const start = newGame(map, { seed: 1, player: 'rome' });
  changeCityOwner(start, 'massalia' as CityId, start.player);
  expect(
    executeOrder(
      start,
      {
        kind: 'evacuate',
        faction: start.player,
        city: 'roma' as CityId,
        to: 'massalia' as CityId,
        share: 0.5,
      },
      world,
    ),
  ).toBeUndefined();
  let previous = start;
  let current = start;
  for (let day = 0; day < 30; day++) {
    previous = current;
    current = tick(previous, [], world).state;
  }
  const column = Object.values(current.refugeeColumns)[0];
  if (!column) throw new Error('the evacuation has no column');
  const original = JSON.stringify([previous, current]);
  let refugees = 0;
  for (const scale of [1, 4])
    for (const progress of [0, 0.5, 1]) {
      const { scene } = expectWholeSceneFits(previous, current, progress, {
        centre: column.position,
        scale,
      });
      refugees += scene.sprites.filter((s) => /^(refugee|cart\.)/.test(s.key)).length;
    }
  expect(refugees).toBeGreaterThan(0);
  expect(JSON.stringify([previous, current])).toBe(original);
  expectConsistent(current);
});

test('a refugee cart regrouped at its column still draws behind a refugee standing below it', () => {
  const start = newGame(map, { seed: 59, player: 'rome' });
  changeCityOwner(start, 'massalia' as CityId, start.player);
  expect(
    executeOrder(
      start,
      {
        kind: 'evacuate',
        faction: start.player,
        city: 'roma' as CityId,
        to: 'massalia' as CityId,
        share: 0.5,
      },
      world,
    ),
  ).toBeUndefined();
  let previous = start;
  let current = start;
  for (let day = 0; day < 30; day++) {
    previous = current;
    current = tick(previous, [], world).state;
  }
  const column = Object.values(current.refugeeColumns)[0];
  if (!column) throw new Error('the evacuation has no column');
  const { raw, scene } = expectWholeSceneFits(previous, current, 0.9, {
    centre: column.position,
    scale: 4,
  });
  const offsets = (sprites: readonly Sprite[]) =>
    sprites
      .map((sprite) => Math.round((sprite.depth - sprite.y) * 1e6) / 1e6 + 0)
      .sort((a, b) => a - b);
  expect(scene.sprites.some((sprite, i) => sprite.x !== raw.sprites[i]?.x)).toBe(true);
  expect(offsets(scene.sprites)).toEqual(offsets(raw.sprites));
  expectConsistent(current);
});

test('coastal towns and villages stand inland on drawn land instead of vanishing', () => {
  const ground = { town: 6.5, village: 6.2 } as const;
  const fits = (settlement: (typeof map.settlements)[number], scale: number) => {
    const camera = { centre: { x: settlement.at[0], y: settlement.at[1] }, scale };
    const toMap = (p: MapPoint) => screenToMap(camera, viewport, p);
    const land = coastalSurface(() => drawn, toMap, physical.land);
    const grow = symbolGrowth(scale);
    const at = mapToScreen(camera, viewport, camera.centre);
    const spot = fitPlace(
      at,
      ground[settlement.rank] * grow,
      3.6 * grow,
      land,
      (p) => {
        const m = toMap(p);
        return physical.land.inside(m.x, m.y);
      },
      scale,
    );
    if (spot) {
      const half = ground[settlement.rank] * grow * spot.growth;
      const base = spot.y + 3.6 * grow * spot.growth;
      expect(
        land.box(spot.x - half, spot.x + half, base - 0.5 * spot.growth, base + 0.5 * spot.growth),
      ).toBe(true);
      expect(Math.hypot(spot.x - at.x, spot.y - at.y) / scale).toBeLessThanOrEqual(
        PLACE_REACH_KM + 1e-9,
      );
    }
    return spot && { ...toMap(spot), growth: spot.growth };
  };
  for (const settlement of map.settlements)
    expect(fits(settlement, 4), settlement.name).toBeDefined();
  const entry = map.settlements.filter((s) => !fits(s, s.rank === 'town' ? 0.76 : 1.71));
  expect(entry.length).toBeLessThanOrEqual(1);
  for (const name of ['Katane', 'Tauromenium', 'Lokroi Epizephyrioi', 'Scylletium']) {
    const town = map.settlements.find((s) => s.name === name);
    if (!town) throw new Error(`no ${name}`);
    expect(fits(town, 4), name).toBeDefined();
    expect(fits(town, 1), name).toBeDefined();
  }
  const samothrace = map.settlements.find((s) => s.name === 'Samothrace');
  if (!samothrace) throw new Error('no Samothrace');
  for (const scale of [0.76, 1, 4]) {
    const spot = fits(samothrace, scale);
    if (!spot) throw new Error(`Samothrace does not fit at ${scale} px/km`);
    expect(Math.hypot(spot.x - samothrace.at[0], spot.y - samothrace.at[1])).toBeLessThan(12);
  }
});
