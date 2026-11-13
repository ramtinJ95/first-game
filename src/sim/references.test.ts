import { expect, test } from 'vitest';
import { buildFixture, FIXTURE } from './fixture.ts';
import type { BattleId, ConvoyId } from './ids.ts';
import { expectConsistent, findBrokenReferences } from './references.ts';
import type { Day } from './state/day.ts';
import { warKey, type WarKey, newWar } from './state/war.ts';

test('an army in a battle that does not list it is reported', () => {
  const state = buildFixture();
  state.nextSerial = 2;
  const battle = 'battle-1' as BattleId;
  state.battles[battle] = {
    id: battle,
    position: { x: 0, y: 0 },
    attackers: [FIXTURE.punicArmy],
    defenders: [],
    startedOn: 1 as Day,
    sides: { attackers: { factions: [], lost: 0 }, defenders: { factions: [], lost: 0 } },
  };
  const army = state.armies[FIXTURE.romanArmy];
  if (army) army.activity = { kind: 'inBattle', position: { x: 0, y: 0 }, battle, march: [] };
  expect(findBrokenReferences(state)).toEqual([
    'army army-roman is in battle battle-1, which does not list it',
    'battle battle-1 lists army army-punic, which is not in it',
  ]);
});

test('an embarked army and its convoy that list each other are valid', () => {
  const state = buildFixture();
  state.nextSerial = 2;
  const convoy = 'convoy-1' as ConvoyId;
  state.convoys[convoy] = {
    id: convoy,
    owner: FIXTURE.rome,
    position: { x: 5, y: 5 },
    armies: [FIXTURE.romanArmy],
    waypoints: [{ x: 6, y: 6 }],
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

test('an id that names a built-in object property is not taken for a record', () => {
  const state = buildFixture();
  const army = state.armies[FIXTURE.romanArmy];
  if (army)
    army.activity = {
      kind: 'inBattle',
      position: { x: 0, y: 0 },
      battle: 'constructor' as BattleId,
      march: [],
    };
  state.player = 'constructor' as typeof state.player;
  expect(findBrokenReferences(state)).toEqual([
    'player faction constructor does not exist',
    'army army-roman is in battle constructor, which does not list it',
  ]);
});

test('an army listed on both sides of a battle is reported', () => {
  const state = buildFixture();
  const battle = 'battle-1' as BattleId;
  state.nextSerial = 2;
  state.battles[battle] = {
    id: battle,
    position: { x: 0, y: 0 },
    attackers: [FIXTURE.romanArmy],
    defenders: [FIXTURE.romanArmy],
    startedOn: 1 as Day,
    sides: { attackers: { factions: [], lost: 0 }, defenders: { factions: [], lost: 0 } },
  };
  const army = state.armies[FIXTURE.romanArmy];
  if (army) army.activity = { kind: 'inBattle', position: { x: 0, y: 0 }, battle, march: [] };
  expect(findBrokenReferences(state)).toEqual(['battle battle-1 lists army-roman twice']);
});

test('a formation listed twice in its army is reported', () => {
  const state = buildFixture();
  state.armies[FIXTURE.punicArmy]?.formations.push(FIXTURE.citizenSpears);
  expect(findBrokenReferences(state)).toEqual([
    'army army-punic lists formation-citizen-spears twice',
  ]);
});

test('an allocated id at or above nextSerial is reported', () => {
  const state = buildFixture();
  const convoy = 'convoy-1' as ConvoyId;
  state.convoys[convoy] = {
    id: convoy,
    owner: FIXTURE.rome,
    position: { x: 0, y: 0 },
    armies: [],
    waypoints: [{ x: 1, y: 1 }],
  };
  expect(findBrokenReferences(state)).toEqual([
    'convoys.convoy-1 is not below nextSerial 1, so a new id could repeat it',
  ]);
});

test('a war with a faction that does not exist is reported', () => {
  const state = buildFixture();
  state.wars[warKey(FIXTURE.rome, 'sparta' as typeof FIXTURE.rome)] = newWar(
    FIXTURE.rome,
    'sparta' as typeof FIXTURE.rome,
    1 as Day,
  );
  expect(findBrokenReferences(state)).toEqual([
    'war ["rome","sparta"] names unknown faction sparta',
  ]);
});

test('a war key out of order or with one faction twice is reported', () => {
  const state = buildFixture();
  state.wars['["rome","carthage"]' as WarKey] = newWar(FIXTURE.rome, FIXTURE.carthage, 1 as Day);
  state.wars['["rome","rome"]' as WarKey] = newWar(FIXTURE.rome, FIXTURE.rome, 1 as Day);
  expect(findBrokenReferences(state)).toEqual([
    'war ["rome","carthage"] does not name two different factions in ascending order',
    'war ["rome","rome"] does not name two different factions in ascending order',
  ]);
});

test('expectConsistent passes a valid state and throws with the list for a broken one', () => {
  const state = buildFixture();
  expect(() => expectConsistent(state)).not.toThrow();
  state.armies[FIXTURE.punicArmy]?.formations.push(FIXTURE.hastati);
  expect(() => expectConsistent(state)).toThrow(
    'The state has broken links: army army-punic lists formation formation-hastati, which does not name it back',
  );
});
