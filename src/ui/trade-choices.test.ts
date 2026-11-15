import { expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import { sightOf } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { tradeChoices } from './trade-choices.ts';

const world = fixtureWorld();

function choicesFromRoma(state: GameState) {
  const roma = state.cities[f.roma];
  if (!roma) throw new Error('missing Roma');
  return tradeChoices(state, world, sightOf(state, world, state.player), roma);
}

test('the partners that agree lead, by payback with every open way, and the rest say why not', () => {
  const state = buildFixture();
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
  const rows = choicesFromRoma(state);
  expect(rows.map((row) => [row.city.id, row.kind])).toEqual(
    expect.arrayContaining([
      [f.capua, 'open'],
      [f.syracusae, 'open'],
      [f.carthago, 'closed'],
    ]),
  );
  const firstClosed = rows.findIndex((row) => row.kind === 'closed');
  expect(rows.slice(firstClosed).every((row) => row.kind === 'closed')).toBe(true);
  const paybacks = rows.flatMap((row) =>
    row.kind === 'open' ? [Math.round(((row.quotes[0]?.paybackDays ?? 0) / 365) * 10)] : [],
  );
  expect(paybacks).toEqual([...paybacks].sort((a, b) => a - b));
  expect(rows.find((row) => row.city.id === f.carthago)).toMatchObject({
    reason: 'the two ends are at war',
  });
  const syracusae = rows.find((row) => row.city.id === f.syracusae);
  expect(syracusae?.kind === 'open' && syracusae.quotes.map((q) => q.mode)).toEqual(['sea']);
});

test('a partner the player cannot afford yet still shows, with the gold it needs', () => {
  const state = buildFixture();
  const rome = state.factions[f.rome];
  if (!rome) throw new Error('missing Rome');
  rome.stores.gold = 100;
  const open = choicesFromRoma(state).filter((row) => row.kind === 'open');
  expect(open.length).toBeGreaterThan(0);
  for (const row of open) expect(row.short).toBe((row.quotes[0]?.cost ?? 0) - 100);
});
