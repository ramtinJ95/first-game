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
import { screenToMap, symbolGrowth } from '../camera.ts';
import type { FigureKind } from '../figures/motions.ts';
import { groundSpan } from '../figures/sheet.ts';
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
    formations,
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { ...at } },
  };
  state.armies[id] = army;
  return army;
}

/** A point `km` from the city toward its nearest neighbour city. */
function towardNeighbour(state: GameState, city: CityId, km: number): MapPoint {
  const at = cityOf(state, city).position;
  const near = (world.map.provinces.find((p) => (p.id as string) === city)?.neighbours ?? [])
    .map((n) => cityOf(state, n as string as CityId).position)
    .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
  if (!near) return at;
  const t = Math.min(1, km / Math.hypot(near.x - at.x, near.y - at.y));
  return { x: at.x + (near.x - at.x) * t, y: at.y + (near.y - at.y) * t };
}

const isFigure = (sprite: Sprite) => sprite.key.split('.').length === 3;

/** The ground a sprite stands on: a figure's feet and hooves at either side, or a tent's or a fire's foot. */
function ground(sprite: Sprite): MapPoint[] {
  const half = isFigure(sprite)
    ? groundSpan(sprite.key.split('.')[0] as FigureKind) * sprite.size
    : 0;
  return [-half, 0, half].map((dx) => ({ x: sprite.x + dx, y: sprite.y }));
}

interface Drawn {
  readonly previous: GameState;
  readonly current: GameState;
  readonly centre: MapPoint;
}

const CASES: readonly (readonly [string, (city: CityId) => Drawn | undefined])[] = [
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
      const state = emptyGame();
      const army = raise(state, rome, 'march', cityOf(state, city).position);
      if (army.activity.kind !== 'idle') return undefined;
      if (startMarch(world, army, army.activity.position, towardNeighbour(state, city, 200))) {
        return undefined;
      }
      const next = tick(state, [], world).state as GameState;
      const a = next.armies[army.id]?.activity;
      if (!a || a.kind === 'embarked') return undefined;
      return { previous: state, current: next, centre: a.position };
    },
  ],
  [
    'in a battle',
    (city) => {
      const state = emptyGame();
      const owner = cityOf(state, city).owner;
      const enemy = owner === rome ? ('carthage' as FactionId) : owner;
      state.wars[warKey(rome, enemy)] = { since: state.day };
      raise(state, enemy, 'defender', cityOf(state, city).position);
      raise(state, rome, 'attacker', towardNeighbour(state, city, 14));
      const next = tick(state, [], world).state as GameState;
      const battle = Object.values(next.battles)[0];
      if (!battle) return undefined;
      const after = tick(next, [], world).state as GameState;
      return { previous: next, current: after, centre: battle.position };
    },
  ],
  [
    'in a siege camp',
    (city) => {
      const state = emptyGame();
      const owner = cityOf(state, city).owner;
      if (owner === rome) return undefined;
      state.wars[warKey(rome, owner)] = { since: state.day };
      raise(state, rome, 'besieger', cityOf(state, city).position);
      const next = tick(state, [], world).state as GameState;
      const after = tick(next, [], world).state as GameState;
      if (Object.keys(after.sieges).length === 0) return undefined;
      return { previous: next, current: after, centre: cityOf(after, city).position };
    },
  ],
];

describe('every city of the map', () => {
  test.each(CASES)(
    'an army %s at any city stands on land at every figure zoom',
    (_, build) => {
      const wet: string[] = [];
      let cities = 0;
      for (const city of CITIES) {
        const drawn = build(city);
        if (!drawn) continue;
        cities++;
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
            const off = scene.sprites
              .filter((s) => !/^(ship|smoke|dust|arrow|javelin)\./.test(s.key))
              .filter((s) => ground(s).some((p) => !onLand(p)));
            if (off.length > 0)
              wet.push(`${city} at ${scale} x${progress}: ${off.length} ${off[0]?.key}`);
          }
        }
      }
      expect(cities).toBeGreaterThan(40);
      expect(wet).toEqual([]);
    },
    300_000,
  );
});
