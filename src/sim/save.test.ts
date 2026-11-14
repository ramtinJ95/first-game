import type { DeepReadonly } from './deep-readonly.ts';
import type { GameState } from './state/game-state.ts';
import { describe, expect, test } from 'vitest';
import { MAX_UNREST_DAYS } from './cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import { loadGame, SAVE_FORMAT, saveGame } from './save.ts';
import { warKey, newWar } from './state/war.ts';
import { tick } from './tick.ts';

const world = fixtureWorld();

describe('save and load', () => {
  test('a state survives save and load unchanged', () => {
    const state = tick(
      buildFixture(42),
      [
        {
          kind: 'moveArmy',
          faction: FIXTURE.rome,
          army: FIXTURE.romanArmy,
          to: { x: 2638.8, y: 2448.3 },
        },
      ],
      world,
    ).state;
    const loaded = loadGame(saveGame(state));
    expect(loaded).toEqual({ ok: true, state });
  });

  test('a read-only state, as the clock hands it out, can be saved', () => {
    const view: DeepReadonly<GameState> = buildFixture();
    expect(loadGame(saveGame(view))).toEqual({ ok: true, state: buildFixture() });
  });

  test('the save names its format version', () => {
    expect(JSON.parse(saveGame(buildFixture()))).toMatchObject({ format: SAVE_FORMAT });
  });

  test('rejects text that is not JSON', () => {
    expect(loadGame('{"format": 1, "state": ')).toEqual({
      ok: false,
      error: 'The save is not valid JSON.',
    });
  });

  test('rejects a save from another format version', () => {
    const save = JSON.stringify({ format: 99, state: buildFixture() });
    expect(loadGame(save)).toEqual({
      ok: false,
      error: `The save has legacy or malformed format 99; it lacks changes: ${SAVE_FORMAT.join(', ')}.`,
    });
  });

  test('refuses an unknown change and names it', () => {
    const result = loadGame(
      JSON.stringify({ format: [...SAVE_FORMAT, 'future-fleets'], state: buildFixture() }),
    );
    expect(result).toEqual({ ok: false, error: 'The save has unknown changes: future-fleets.' });
  });

  test('refuses a missing change and names what it adds', () => {
    const result = loadGame(
      JSON.stringify({
        format: SAVE_FORMAT.filter((name) => name !== 'baseline-format-12'),
        state: buildFixture(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('lacks changes: baseline-format-12');
      expect(result.error).toContain('army names');
    }
  });

  test('treats the format as a set, not an ordered version sequence', () => {
    expect(
      loadGame(JSON.stringify({ format: [...SAVE_FORMAT].reverse(), state: buildFixture() })),
    ).toEqual({ ok: true, state: buildFixture() });
  });

  test('rejects duplicate and non-string changes', () => {
    for (const format of [[...SAVE_FORMAT, SAVE_FORMAT[0]], [13], null]) {
      expect(loadGame(JSON.stringify({ format, state: buildFixture() })).ok).toBe(false);
    }
  });

  test('rejects a save without a format version', () => {
    expect(loadGame(JSON.stringify(buildFixture()))).toEqual({
      ok: false,
      error: 'The save has no format version or no game state.',
    });
  });

  test('rejects a malformed state and says where', () => {
    const save = JSON.parse(saveGame(buildFixture())) as {
      state: { armies: Record<string, { stance: string }> };
    };
    const army = save.state.armies[FIXTURE.romanArmy];
    if (army) army.stance = 'charge';
    const result = loadGame(JSON.stringify(save));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(
        /^The save's game state is malformed at state\.armies\.army-roman\.stance: /,
      );
  });

  test('rejects a state whose records point at missing records', () => {
    const save = JSON.parse(saveGame(buildFixture())) as {
      state: { cities: Record<string, { owner: string }> };
    };
    const capua = save.state.cities[FIXTURE.capua];
    if (capua) capua.owner = 'sparta';
    expect(loadGame(JSON.stringify(save))).toEqual({
      ok: false,
      error: "The save's records disagree: city capua has unknown owner sparta.",
    });
  });

  test('rejects an id counter that could no longer count up exactly', () => {
    const save = JSON.parse(saveGame(buildFixture())) as { state: { nextSerial: number } };
    save.state.nextSerial = 2 ** 53;
    const result = loadGame(JSON.stringify(save));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/^The save's game state is malformed at state\.nextSerial: /);
  });

  test('rejects a war that names one faction twice', () => {
    const save = JSON.parse(saveGame(buildFixture())) as {
      state: { wars: Record<string, unknown> };
    };
    save.state.wars['["rome","rome"]'] = { since: 1 };
    const result = loadGame(JSON.stringify(save));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/^The save's game state is malformed at state\.wars/);
  });

  test('a war with a faction whose id holds any character saves and loads', () => {
    const state = buildFixture();
    const odd = 'x|y"]' as typeof FIXTURE.rome;
    state.factions[odd] = {
      id: odd,
      name: 'Odd',
      kind: 'minor',
      stores: { gold: 0, food: 0, manpower: 0 },
      defeatedOn: null,
    };
    state.wars[warKey(FIXTURE.rome, odd)] = newWar(FIXTURE.rome, odd, state.day);
    expect(loadGame(saveGame(state))).toEqual({ ok: true, state });
  });

  test('drops fields the state does not know', () => {
    const save = JSON.parse(saveGame(buildFixture())) as { state: Record<string, unknown> };
    save.state['cheat'] = true;
    const result = loadGame(JSON.stringify(save));
    expect(result).toEqual({ ok: true, state: buildFixture() });
  });

  test('rejects a city with more unrest than any fall gives', () => {
    const state = buildFixture();
    const roma = state.cities[FIXTURE.roma];
    if (!roma) throw new Error('the fixture lacks Roma');
    roma.unrestDays = MAX_UNREST_DAYS + 1;
    const result = loadGame(saveGame(state));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(
      /^The save's game state is malformed at state\.cities\.roma\.unrestDays/,
    );
  });
});
