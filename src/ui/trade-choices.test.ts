import { expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import { sightOf } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { newGame } from '../sim/new-game.ts';
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
    row.kind === 'open' ? [Math.round(((row.ways[0]?.quote.paybackDays ?? 0) / 365) * 10)] : [],
  );
  expect(paybacks).toEqual([...paybacks].sort((a, b) => a - b));
  expect(rows.find((row) => row.city.id === f.carthago)).toMatchObject({
    reason: 'the two ends are at war',
  });
  const syracusae = rows.find((row) => row.city.id === f.syracusae);
  expect(syracusae?.kind === 'open' && syracusae.ways.map((w) => w.quote.mode)).toEqual(['sea']);
});

test('a partner the player cannot afford yet still shows, with the gold it needs', () => {
  const state = buildFixture();
  const rome = state.factions[f.rome];
  if (!rome) throw new Error('missing Rome');
  rome.stores.gold = 100;
  const open = choicesFromRoma(state).filter((row) => row.kind === 'open');
  expect(open.length).toBeGreaterThan(0);
  for (const row of open) for (const way of row.ways) expect(way.short).toBe(way.quote.cost - 100);
});

test('each way to a partner carries its own risk and the gold it still needs', () => {
  const first = newGame(world.map, { seed: 1, player: 'rome' });
  const start = first.cities[f.roma];
  if (!start) throw new Error('missing Roma');
  const both = tradeChoices(first, world, sightOf(first, world, first.player), start).find(
    (row) => row.kind === 'open' && row.ways.length === 2,
  );
  if (both?.kind !== 'open') throw new Error('expected a partner open by land and by sea');
  const land = both.ways.find((way) => way.quote.mode === 'land');
  const sea = both.ways.find((way) => way.quote.mode === 'sea');
  if (!land || !sea) throw new Error('expected both ways');
  const state = newGame(world.map, { seed: 1, player: 'rome' });
  const roma = state.cities[f.roma];
  if (!roma) throw new Error('missing Roma');
  const everyone = sightOf(state, world, state.player);
  const enemy = Object.values(state.factions).find(
    (faction) => faction.kind === 'greatPower' && faction.id !== state.player,
  );
  const army = Object.values(state.armies).find((a) => a.owner === enemy?.id);
  const middle = land.quote.path[Math.floor(land.quote.path.length / 2)];
  const rome = state.factions[state.player];
  if (!enemy || !army || !middle || !rome) throw new Error('missing enemy, army or road');
  state.wars[warKey(state.player, enemy.id)] = newWar(state.player, enemy.id, state.day);
  army.activity = { kind: 'idle', position: { ...middle } };
  rome.stores.gold = Math.min(land.quote.cost, sea.quote.cost);
  const sight = { ...everyone, armies: new Set([army.id]) };
  const row = tradeChoices(state, world, sight, roma).find((r) => r.city.id === both.city.id);
  if (row?.kind !== 'open') throw new Error('expected the partner to still agree');
  const now = Object.fromEntries(row.ways.map((way) => [way.quote.mode, way]));
  expect(now.land?.risks).toContainEqual(expect.objectContaining({ kind: 'raids', near: 1 }));
  expect(now.sea?.risks.some((risk) => risk.kind === 'raids')).toBe(false);
  expect(row.ways.map((way) => way.short).sort((a, b) => a - b)).toEqual([
    0,
    Math.abs(land.quote.cost - sea.quote.cost),
  ]);
});
