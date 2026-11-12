import { expect, test } from 'vitest';
import { buildFixture, FIXTURE } from './fixture.ts';
import type { BattleId, ConvoyId } from './ids.ts';
import { findBrokenReferences } from './references.ts';
import type { Day } from './state/day.ts';

test('an army in a battle that does not list it is reported', () => {
  const state = buildFixture();
  const battle = 'battle-1' as BattleId;
  state.battles[battle] = {
    id: battle,
    position: { x: 0, y: 0 },
    attackers: [FIXTURE.punicArmy],
    defenders: [],
    startedOn: 1 as Day,
  };
  const army = state.armies[FIXTURE.romanArmy];
  if (army) army.activity = { kind: 'inBattle', position: { x: 0, y: 0 }, battle };
  expect(findBrokenReferences(state)).toEqual([
    'army army-roman is in battle battle-1, which does not list it',
    'battle battle-1 lists army army-punic, which is not in it',
  ]);
});

test('an embarked army and its convoy that list each other are valid', () => {
  const state = buildFixture();
  const convoy = 'convoy-1' as ConvoyId;
  state.convoys[convoy] = {
    id: convoy,
    owner: FIXTURE.rome,
    position: { x: 5, y: 5 },
    armies: [FIXTURE.romanArmy],
  };
  const army = state.armies[FIXTURE.romanArmy];
  if (army) army.activity = { kind: 'embarked', convoy };
  expect(findBrokenReferences(state)).toEqual([]);
});

test('a record stored under another id is reported', () => {
  const state = buildFixture();
  const roma = state.cities[FIXTURE.roma];
  if (roma) state.cities[FIXTURE.roma] = { ...roma, id: FIXTURE.capua };
  expect(findBrokenReferences(state)).toContain('cities.roma holds a record with id capua');
});
