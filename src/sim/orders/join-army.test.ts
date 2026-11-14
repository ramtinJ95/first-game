import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { ArmyId, FormationId } from '../ids.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import { reforming, REFORM_DAYS } from '../systems/battles.ts';
import { menOf } from '../systems/economy.ts';
import { tick } from '../tick.ts';
import type { Order } from './orders.ts';

const world = fixtureWorld();
const second = 'army-roman-2' as ArmyId;

/** The First Legion and a Second Legion of archers under a better general, idle at Roma. */
function twoLegionsAtRoma(): GameState {
  const state = buildFixture();
  const roma = state.cities[FIXTURE.roma];
  const first = state.armies[FIXTURE.romanArmy];
  if (!roma || !first) throw new Error('the fixture has changed');
  first.activity = { kind: 'idle', position: { ...roma.position } };
  const formation = 'formation-roman-2' as FormationId;
  state.formations[formation] = {
    id: formation,
    army: second,
    troop: 'archers',
    men: 300,
    morale: 1,
  };
  state.armies[second] = {
    id: second,
    owner: FIXTURE.rome,
    formations: [formation],
    stance: 'holdTheLine',
    name: 'Second Legion',
    generalSkill: 7,
    activity: { kind: 'idle', position: { x: roma.position.x + 5, y: roma.position.y } },
  };
  return state;
}

const join: Order = {
  kind: 'joinArmy',
  faction: FIXTURE.rome,
  army: second,
  into: FIXTURE.romanArmy,
};

const romanMen = (state: GameState) =>
  Object.values(state.armies)
    .filter((army) => army.owner === FIXTURE.rome)
    .reduce((sum, army) => sum + menOf(state, army), 0);

describe('joinArmy', () => {
  test('puts every formation of the army into the army it joins, under the better general', () => {
    const state = twoLegionsAtRoma();
    const { state: next, rejected } = tick(state, [join], world);
    expect(rejected).toEqual([]);
    expect(next.armies[second]).toBeUndefined();
    const first = next.armies[FIXTURE.romanArmy];
    expect(first?.formations).toContain('formation-roman-2');
    expect(first?.generalSkill).toBe(7);
    expect(romanMen(next)).toBe(romanMen(state));
    expectConsistent(next);
  });

  test('is refused while either army re-forms, so a join never cuts the re-forming short', () => {
    for (const changed of [FIXTURE.romanArmy, second]) {
      let state = twoLegionsAtRoma();
      const stance: Order = {
        kind: 'setStance',
        faction: FIXTURE.rome,
        army: changed,
        stance: 'allOutAssault',
      };
      state = tick(state, [stance], world).state;
      const refused = tick(state, [join], world);
      expect(refused.rejected.map(({ reason }) => reason)).toEqual([
        `army ${changed} is re-forming`,
      ]);
      expect(reforming(refused.state, refused.state.armies[changed] ?? {})).toBe(true);
      expectConsistent(refused.state);
    }
  });

  test('re-forms the army from today when the army that joins it stood in another stance', () => {
    let state = twoLegionsAtRoma();
    const stance: Order = {
      kind: 'setStance',
      faction: FIXTURE.rome,
      army: second,
      stance: 'skirmishAndWithdraw',
    };
    state = tick(state, [stance], world).state;
    for (let day = 1; day < REFORM_DAYS; day++) state = tick(state, [], world).state;
    const { state: next, rejected } = tick(state, [join], world);
    expect(rejected).toEqual([]);
    const first = next.armies[FIXTURE.romanArmy];
    if (!first) throw new Error('the First Legion is gone');
    expect(first.stance).toBe('holdTheLine');
    expect(reforming(next, first)).toBe(true);
    expectConsistent(next);
  });

  test('is refused for an army too far away, on the march, or of another owner', () => {
    const far = twoLegionsAtRoma();
    const roma = far.cities[FIXTURE.roma];
    const army = far.armies[second];
    if (!roma || !army) throw new Error('the fixture has changed');
    army.activity = { kind: 'idle', position: { x: roma.position.x + 40, y: roma.position.y } };
    expect(tick(far, [join], world).rejected.map(({ reason }) => reason)).toEqual([
      `army ${second} is too far from army ${FIXTURE.romanArmy} to join it`,
    ]);

    const marching = twoLegionsAtRoma();
    const moving = marching.armies[second];
    if (!moving) throw new Error('no Second Legion');
    moving.activity = {
      kind: 'marching',
      position: { ...army.activity.position },
      waypoints: [{ x: roma.position.x + 60, y: roma.position.y }],
    };
    expect(tick(marching, [join], world).rejected.map(({ reason }) => reason)).toEqual([
      `army ${second} is not standing still`,
    ]);

    const foreign = twoLegionsAtRoma();
    const punic: Order = { ...join, into: FIXTURE.punicArmy };
    expect(tick(foreign, [punic], world).rejected.map(({ reason }) => reason)).toEqual([
      `army ${FIXTURE.punicArmy} belongs to ${FIXTURE.carthage}, not ${FIXTURE.rome}`,
    ]);
    expectConsistent(foreign);
  });
});
