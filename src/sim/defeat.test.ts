import { expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import type { ArmyId, FormationId, RefugeeColumnId } from './ids.ts';
import { executeOrder } from './orders/orders.ts';
import { expectConsistent } from './references.ts';
import { tick } from './tick.ts';

const world = fixtureWorld();

test('a faction that loses its last city leaves the game with its armies, stores, and wars', () => {
  const state = buildFixture();
  executeOrder(
    state,
    { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage },
    world,
  );
  const roman = state.armies[FIXTURE.romanArmy];
  const punic = state.armies[FIXTURE.punicArmy];
  const carthago = state.cities[FIXTURE.carthago];
  if (!roman || !punic || !carthago) throw new Error('the fixture is missing records');
  roman.activity = { kind: 'idle', position: { x: 2232.9, y: 2865.1 } };
  punic.activity = { kind: 'idle', position: { x: 2511.3, y: 2339.8 } };
  carthago.foodDays = 0;
  carthago.garrison = 200;
  const raider = 'army-raider' as ArmyId;
  const formation = 'formation-raider' as FormationId;
  state.formations[formation] = {
    id: formation,
    army: raider,
    troop: 'archers',
    men: 300,
    morale: 1,
  };
  state.armies[raider] = {
    id: raider,
    owner: FIXTURE.carthage,
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 0,
    activity: { kind: 'idle', position: { x: 0, y: 0 } },
  };
  const column = 'refugeeColumn-1' as RefugeeColumnId;
  state.nextSerial = 2;
  state.refugeeColumns[column] = {
    id: column,
    owner: FIXTURE.carthage,
    people: 500,
    from: FIXTURE.carthago,
    to: FIXTURE.carthago,
    position: { x: 2199.9, y: 2865.1 },
    waypoints: [{ x: 2229.9, y: 2865.1 }],
  };

  const first = tick(state, [], world).state;
  expect(
    Object.values(first.sieges)
      .map((siege) => siege.city)
      .sort(),
  ).toEqual([FIXTURE.carthago, FIXTURE.roma]);
  const fallen = tick(first, [], world).state;
  expect(fallen.cities[FIXTURE.carthago]?.owner).toBe(FIXTURE.rome);
  expect(fallen.factions[FIXTURE.carthage]).toMatchObject({
    defeatedOn: 2,
    stores: { gold: 0, food: 0, manpower: 0 },
  });
  expect(Object.values(fallen.armies).map((army) => army.owner)).toEqual([FIXTURE.rome]);
  expect(fallen.refugeeColumns).toEqual({});
  expect(fallen.wars).toEqual({});
  expect(fallen.sieges).toEqual({});
  expect(
    [
      executeOrder(
        fallen,
        {
          kind: 'declareWar',
          faction: FIXTURE.carthage,
          against: FIXTURE.rome,
        },
        world,
      ),
      executeOrder(
        fallen,
        {
          kind: 'declareWar',
          faction: FIXTURE.rome,
          against: FIXTURE.carthage,
        },
        world,
      ),
    ].map((rejection) => rejection?.reason),
  ).toEqual(['faction carthage is out of the game', 'faction carthage is out of the game']);
  expectConsistent(fallen);
  expectConsistent(tick(fallen, [], world).state);
});
