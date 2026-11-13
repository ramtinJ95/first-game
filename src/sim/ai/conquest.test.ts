import { describe, expect, test } from 'vitest';
import { fixtureWorld } from '../fixture.ts';
import { allocateId, type ArmyId, type FactionId } from '../ids.ts';
import { newGame } from '../new-game.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { removeRecord } from '../records.ts';
import { expectConsistent } from '../references.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { tick } from '../tick.ts';
import { distance } from '../world/find-path.ts';
import { decideOrders } from './decide.ts';
import { byLand } from './situation.ts';

const world = fixtureWorld();
const rome = 'rome' as FactionId;

function addArmy(state: GameState, owner: FactionId, men: number, at: MapPoint): ArmyId {
  const id = allocateId(state, 'army');
  const formation = allocateId(state, 'formation');
  state.formations[formation] = { id: formation, army: id, troop: 'spearmen', men, morale: 1 };
  state.armies[id] = {
    id,
    owner,
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { ...at } },
  };
  return id;
}

function cityOf(state: GameState, faction: FactionId): City {
  const city = Object.values(state.cities).find((c) => c.owner === faction);
  if (!city) throw new Error(`${faction} holds no city`);
  return city;
}

describe('a siege the attack can hold', () => {
  /** Rome at war with the minor nearest Roma by land, with every minor army gone. */
  function war() {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const roma = cityOf(state, rome);
    const [target] = Object.values(state.cities)
      .filter(
        (city) =>
          state.factions[city.owner]?.kind === 'minor' &&
          byLand(world, roma.position, city.position),
      )
      .sort((a, b) => distance(a.position, roma.position) - distance(b.position, roma.position));
    if (!target) throw new Error('no minor city by land from Roma');
    for (const army of Object.values(state.armies)) {
      for (const id of army.formations) removeRecord(state.formations, id);
      removeRecord(state.armies, army.id);
    }
    Object.assign(target, { garrison: 1200, walls: 100, foodDays: 40 });
    expect(
      executeOrder(state, { kind: 'declareWar', faction: rome, against: target.owner }, world),
    ).toBeUndefined();
    const far = Object.values(state.cities)
      .filter((city) => city.owner === rome)
      .sort(
        (a, b) => distance(b.position, target.position) - distance(a.position, target.position),
      )[0];
    if (!far) throw new Error('rome holds no city');
    return { state, target, far };
  }

  test('an army too few to blockade alone does not march ahead of the army that makes it enough', () => {
    const { state, target, far } = war();
    const near = { x: target.position.x + 30, y: target.position.y };
    expect(byLand(world, near, target.position)).toBe(true);
    const ahead = addArmy(state, rome, 400, near);
    addArmy(state, rome, 1700, far.position);
    const orders = decideOrders(state, world, rome);
    expect(orders).not.toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: ahead, to: target.position }),
    );
    expectConsistent(state);
  });

  function waiting(extra?: { men: number; km: number }) {
    const { state, target } = war();
    const besiegers = addArmy(state, rome, 1000, target.position);
    const coming = addArmy(state, rome, 600, { x: target.position.x + 40, y: target.position.y });
    const orders: Order[] = [
      { kind: 'moveArmy', faction: rome, army: coming, to: target.position },
    ];
    if (extra) {
      const from = { x: target.position.x + extra.km, y: target.position.y };
      expect(byLand(world, from, target.position)).toBe(true);
      const late = addArmy(state, rome, extra.men, from);
      orders.push({ kind: 'moveArmy', faction: rome, army: late, to: target.position });
    }
    return { state: tick(state, orders, world).state, target, besiegers, coming };
  }

  test('a siege too weak to blockade waits for an army that arrives before sallies wear it down, and the two blockade the city', () => {
    let { state, target, besiegers, coming } = waiting();
    expect(state.armies[besiegers]?.activity.kind).toBe('besieging');
    for (let day = 0; day < 5; day++) {
      const orders = decideOrders(state, world, rome);
      expect(orders).not.toContainEqual(
        expect.objectContaining({ kind: 'moveArmy', army: besiegers }),
      );
      expect(orders).not.toContainEqual(
        expect.objectContaining({ kind: 'moveArmy', army: coming }),
      );
      state = tick(state, orders, world).state;
    }
    const siege = Object.values(state.sieges).find((s) => s.city === target.id);
    expect(siege?.besiegers).toEqual(expect.arrayContaining([besiegers, coming]));
    expectConsistent(state);
  });

  test('a far army on its way does not make a siege that is reinforced in time give up', () => {
    const { state, besiegers } = waiting({ men: 100, km: 400 });
    expect(decideOrders(state, world, rome)).not.toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: besiegers }),
    );
    expectConsistent(state);
  });
});
