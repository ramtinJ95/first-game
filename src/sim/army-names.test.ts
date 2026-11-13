import { describe, expect, it } from 'vitest';
import mapData from '../../data/map/map.json' with { type: 'json' };
import { armyName, ordinal } from './army-names.ts';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import type { FactionId } from './ids.ts';
import { parseMap } from './map.ts';
import { newGame } from './new-game.ts';
import { expectConsistent } from './references.ts';
import { loadGame, saveGame } from './save.ts';
import type { Day } from './state/day.ts';
import { tick } from './tick.ts';

const world = fixtureWorld();

describe('army names', () => {
  it('names each starting army in its power manner', () => {
    const state = newGame(parseMap(mapData), { seed: 1, player: 'rome' });
    const names = Object.fromEntries(
      Object.values(state.armies)
        .filter((army) => state.factions[army.owner]?.kind === 'greatPower')
        .map((army) => [army.owner, army.name]),
    );
    const minor = Object.values(state.armies).find(
      (army) => state.factions[army.owner]?.kind === 'minor',
    );
    expect(minor?.name).toBe(`Army of ${state.factions[minor?.owner ?? FIXTURE.rome]?.name}`);
    expect(names).toEqual({
      rome: 'First Legion',
      carthage: 'Host of Hanno',
      macedon: 'Phalanx of Antigonus',
      egypt: 'Host of Amun',
      persia: 'Host of the Immortals',
    });
    expectConsistent(state);
  });

  it('gives a mustered army the next name, and the army keeps it through days and a save', () => {
    const state = buildFixture();
    const roman = state.armies[FIXTURE.romanArmy];
    if (!roman) throw new Error('no roman army');
    roman.activity = { kind: 'idle', position: { x: 2700, y: 2600 } };
    state.cities[FIXTURE.capua]?.recruits.push({ troop: 'spearmen', readyOn: 1 as Day });
    let next = tick(state, [], world).state;
    const raised = Object.values(next.armies).filter((army) => army.id !== FIXTURE.romanArmy);
    const legion = raised.find((army) => army.owner === FIXTURE.rome);
    expect(legion?.name).toBe('Second Legion');
    for (let i = 0; i < 5; i++) next = tick(next, [], world).state;
    const loaded = loadGame(saveGame(next));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state.armies[legion?.id ?? FIXTURE.romanArmy]?.name).toBe('Second Legion');
    expect(loaded.state.armies[FIXTURE.romanArmy]?.name).toBe('First Legion');
    expectConsistent(loaded.state);
  });

  it('starts the names again with an ordinal once a power has used them all', () => {
    const state = buildFixture();
    expect(armyName(state, FIXTURE.carthage, 13)).toBe('Second Host of Hanno');
    expect(armyName(state, FIXTURE.rome, 21)).toBe('21st Legion');
    expect(armyName(state, FIXTURE.syracusaeFaction, 1)).toBe('Army of Syracusae');
    expect(armyName(state, FIXTURE.syracusaeFaction, 2)).toBe('Second Army of Syracusae');
    expect(armyName(state, 'nobody' as FactionId, 1)).toBe('Army of nobody');
    expect([ordinal(22), ordinal(23), ordinal(111)]).toEqual(['22nd', '23rd', '111th']);
  });
});
