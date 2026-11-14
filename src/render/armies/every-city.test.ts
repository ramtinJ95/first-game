import { describe, expect, test } from 'vitest';
import { fixtureWorld } from '../../sim/fixture.ts';
import type { ArmyId, BattleId, CityId, FactionId, FormationId } from '../../sim/ids.ts';
import { startMarch } from '../../sim/march.ts';
import { newGame } from '../../sim/new-game.ts';
import type { Sight } from '../../sim/sight.ts';
import type { Army } from '../../sim/state/army.ts';
import type { GameState } from '../../sim/state/game-state.ts';
import type { MapPoint } from '../../sim/state/map-point.ts';
import { warKey } from '../../sim/state/war.ts';
import { tick } from '../../sim/tick.ts';
import type { Troop } from '../../sim/troops.ts';
import { mapToScreen, screenToMap, symbolGrowth } from '../camera.ts';
import type { Box } from '../labels.ts';
import { groundSpan, type GroundArt } from '../figures/sheet.ts';
import { Land } from '../terrain/marks.ts';
import { buildScene, type Sprite } from './scene.ts';

const viewport = { width: 1280, height: 720 };
const world = fixtureWorld();
const land = new Land(world.map);
const CITIES = world.map.provinces.map((p) => p.id as string as CityId);
const SCALES = [0.9, 1.6, 2.6, 4];
const rome = 'rome' as FactionId;
const ARMY: readonly (readonly [Troop, number])[] = [
  ['spearmen', 1400],
  ['swordsmen', 1000],
  ['archers', 500],
  ['lightCavalry', 400],
  ['heavyCavalry', 400],
];

function seeAll(state: GameState): Sight {
  return {
    faction: state.player,
    provinces: new Set(),
    circles: [],
    armies: new Set(Object.keys(state.armies) as ArmyId[]),
    convoys: new Set(),
    refugeeColumns: new Set(),
    battles: new Set(Object.keys(state.battles) as BattleId[]),
    sees: () => true,
  };
}

function cityOf(state: GameState, id: CityId) {
  const city = state.cities[id];
  if (!city) throw new Error(`no city ${id}`);
  return city;
}

/** A new game with no armies but the ones a case places. */
function emptyGame(): GameState {
  const state = newGame(world.map, { seed: 1, player: 'rome' });
  state.armies = {};
  state.formations = {};
  return state;
}

function raise(state: GameState, owner: FactionId, tag: string, at: MapPoint): Army {
  const id = `army-${tag}` as ArmyId;
  const formations = ARMY.map(([troop, men]) => {
    const formation = `formation-${tag}-${troop}` as FormationId;
    state.formations[formation] = { id: formation, army: id, troop, men, morale: 1 };
    return formation;
  });
  const army: Army = {
    id,
    owner,
    name: 'Test Army',
    formations,
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { ...at } },
  };
  state.armies[id] = army;
  return army;
}

/**
 * Land points `km` from the city: toward each neighbour city, nearest first, then round
 * the compass, so a city on an island or a cape still has somewhere to march or fight.
 */
function landNear(state: GameState, city: CityId, km: number): MapPoint[] {
  const at = cityOf(state, city).position;
  const toward = (to: MapPoint) => {
    const t = km / Math.max(km, Math.hypot(to.x - at.x, to.y - at.y));
    return { x: at.x + (to.x - at.x) * t, y: at.y + (to.y - at.y) * t };
  };
  const neighbours = (world.map.provinces.find((p) => (p.id as string) === city)?.neighbours ?? [])
    .map((n) => cityOf(state, n as string as CityId).position)
    .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
  const compass = Array.from({ length: 16 }, (_, k) => ({
    x: at.x + Math.cos((k / 16) * Math.PI * 2) * km,
    y: at.y + Math.sin((k / 16) * Math.PI * 2) * km,
  }));
  return [...neighbours.map(toward), ...compass].filter((p) => land.open(p.x, p.y));
}

/** The faction that fights the city's owner: Rome, or Carthage at a Roman city. */
function enemyOf(state: GameState, city: CityId): FactionId {
  return cityOf(state, city).owner === rome ? ('carthage' as FactionId) : rome;
}

/** The ground a sprite stands on: a figure's feet and hooves, or a tent's, fire's, or stake's base, at either side. */
function ground(sprite: Sprite): MapPoint[] {
  const art = sprite.key.split(/[.@]/)[0] as GroundArt;
  const half = groundSpan(art) * sprite.size;
  return [-half, 0, half].map((dx) => ({ x: sprite.x + dx, y: sprite.y }));
}

interface Drawn {
  readonly previous: GameState;
  readonly current: GameState;
  readonly centre: MapPoint;
}

const CASES: readonly (readonly [string, (city: CityId) => Drawn])[] = [
  [
    'at rest',
    (city) => {
      const state = emptyGame();
      raise(state, rome, 'rest', cityOf(state, city).position);
      return { previous: state, current: state, centre: cityOf(state, city).position };
    },
  ],
  [
    'on the march',
    (city) => {
      for (const to of [...landNear(emptyGame(), city, 200), ...landNear(emptyGame(), city, 60)]) {
        const state = emptyGame();
        const army = raise(state, rome, 'march', cityOf(state, city).position);
        if (army.activity.kind !== 'idle') continue;
        if (startMarch(world, army, army.activity.position, to)) continue;
        const next = tick(state, [], world).state as GameState;
        const a = next.armies[army.id]?.activity;
        if (a?.kind !== 'marching') continue;
        return { previous: state, current: next, centre: a.position };
      }
      throw new Error(`no march from ${city}`);
    },
  ],
  [
    'in a battle',
    (city) => {
      for (const at of landNear(emptyGame(), city, 14)) {
        const state = emptyGame();
        const enemy = enemyOf(state, city);
        const owner = enemy === rome ? ('carthage' as FactionId) : cityOf(state, city).owner;
        state.wars[warKey(enemy, owner)] = { since: state.day };
        raise(state, owner, 'defender', cityOf(state, city).position);
        raise(state, enemy, 'attacker', at);
        const next = tick(state, [], world).state as GameState;
        const battle = Object.values(next.battles)[0];
        if (!battle) continue;
        const after = tick(next, [], world).state as GameState;
        if (Object.keys(after.battles).length === 0) continue;
        return { previous: next, current: after, centre: battle.position };
      }
      throw new Error(`no battle at ${city}`);
    },
  ],
  [
    'in a siege camp',
    (city) => {
      const state = emptyGame();
      const enemy = enemyOf(state, city);
      state.wars[warKey(enemy, cityOf(state, city).owner)] = { since: state.day };
      raise(state, enemy, 'besieger', cityOf(state, city).position);
      const next = tick(state, [], world).state as GameState;
      const after = tick(next, [], world).state as GameState;
      if (Object.keys(after.sieges).length === 0) throw new Error(`no siege of ${city}`);
      return { previous: next, current: after, centre: cityOf(after, city).position };
    },
  ],
];

describe('every city of the map', () => {
  test.each(CASES)(
    'an army %s at any city stands on land at every figure zoom',
    (name, build) => {
      const camp = name === 'in a siege camp';
      const wet: string[] = [];
      const empty: string[] = [];
      for (const city of CITIES) {
        const drawn = build(city);
        for (const scale of SCALES) {
          const camera = { centre: drawn.centre, scale };
          const onLand = (p: MapPoint) => {
            const point = screenToMap(camera, viewport, p);
            return land.open(point.x, point.y);
          };
          for (const progress of [0, 0.5, 1]) {
            const scene = buildScene({
              previous: drawn.previous,
              current: drawn.current,
              progress,
              camera,
              viewport,
              previousSight: seeAll(drawn.previous),
              sight: seeAll(drawn.current),
              motion: 3.2,
              now: 7.1,
              growth: symbolGrowth(scale),
              land: onLand,
            });
            const figures = scene.sprites.filter((s) => s.army !== undefined).length;
            const tents = scene.sprites.filter((s) => /^(tent|commandTent)\./.test(s.key)).length;
            if (figures === 0 || (camp && tents === 0)) {
              empty.push(`${city} at ${scale} x${progress}: ${figures} figures, ${tents} tents`);
            }
            const off = scene.sprites
              .filter((s) => !/^(ship|smoke|dust|arrow|javelin)\./.test(s.key))
              .filter((s) => ground(s).some((p) => !onLand(p)));
            if (off.length > 0)
              wet.push(`${city} at ${scale} x${progress}: ${off.length} ${off[0]?.key}`);
          }
        }
      }
      expect(empty).toEqual([]);
      expect(wet).toEqual([]);
    },
    300_000,
  );
});

describe('a siege camp beside the places round its city', () => {
  /** Towns within reach of a city's siege ring, with the city: Mediolanum, and every coastal city, with the towns within 50 km. */
  const sieges = world.map.provinces
    .filter((p) => p.id === 'mediolanum' || p.coastal)
    .map((p) => ({
      city: p.id as string as CityId,
      towns: world.map.settlements.filter(
        (s) => Math.hypot(s.at[0] - p.city[0], s.at[1] - p.city[1]) < 50,
      ),
    }))
    .filter(({ towns }) => towns.length > 0);

  test.each([1.6, 2.2, 3])(
    'leaves every town, its name, and the city name clear at %s px per km',
    (scale) => {
      expect(sieges.map(({ city }) => city)).toContain('mediolanum');
      const covered: string[] = [];
      for (const { city, towns } of sieges) {
        const state = emptyGame();
        const enemy = enemyOf(state, city);
        state.wars[warKey(enemy, cityOf(state, city).owner)] = { since: state.day };
        raise(state, enemy, 'besieger', cityOf(state, city).position);
        const next = tick(state, [], world).state as GameState;
        const after = tick(next, [], world).state as GameState;
        const camera = { centre: cityOf(after, city).position, scale };
        const screen = (p: MapPoint) => mapToScreen(camera, viewport, p);
        const places: Box[] = towns.flatMap((town) => {
          const at = screen({ x: town.at[0], y: town.at[1] });
          return [
            { left: at.x - 9, top: at.y - 8, right: at.x + 9, bottom: at.y + 6 },
            {
              left: at.x + 12,
              top: at.y - 7,
              right: at.x + 12 + town.name.length * 6.2,
              bottom: at.y + 7,
            },
          ];
        });
        const c = screen(cityOf(after, city).position);
        const name: Box = {
          left: c.x + 22,
          top: c.y - 8,
          right: c.x + 22 + cityOf(after, city).name.length * 6.2,
          bottom: c.y + 8,
        };
        const onLand = (p: MapPoint) => {
          const point = screenToMap(camera, viewport, p);
          return land.open(point.x, point.y);
        };
        const scene = buildScene({
          previous: next,
          current: after,
          progress: 0.5,
          camera,
          viewport,
          previousSight: seeAll(next),
          sight: seeAll(after),
          motion: 3.2,
          now: 7.1,
          growth: symbolGrowth(scale),
          land: onLand,
          keepClear: places,
          names: new Map([[city, name]]),
        });
        const camp = scene.sprites.filter(
          (s) => s.army !== undefined || /^(tent|commandTent|fire|stakes|arms)\./.test(s.key),
        );
        expect(camp.length).toBeGreaterThan(0);
        const over = camp.filter((s) =>
          [...places, name].some(
            (b) =>
              s.x + 0.3 * s.size > b.left &&
              s.x - 0.3 * s.size < b.right &&
              s.y > b.top &&
              s.y - 1.1 * s.size < b.bottom,
          ),
        );
        if (over.length > 0) covered.push(`${city}: ${over.length} ${over[0]?.key}`);
        expect(camp.filter((s) => ground(s).some((p) => !onLand(p)))).toEqual([]);
      }
      expect(covered).toEqual([]);
    },
    120_000,
  );
});
