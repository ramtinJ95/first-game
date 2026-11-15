import { describe, expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import { sightOf, type Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { tradeForecast } from '../sim/trade/routes.ts';
import { paybackText, riskMark, riskText, tradeRisk } from './trade-risk.ts';

const world = fixtureWorld();

function city(state: GameState, id: typeof f.roma) {
  const found = state.cities[id];
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

/** What the player reads about a quote from Roma, with the road the quote takes. */
function read(state: GameState, to: typeof f.roma, mode: 'land' | 'sea', sight?: Sight) {
  const roma = city(state, f.roma);
  const other = city(state, to);
  const quote = tradeForecast(state, world, roma, other, mode);
  if (!quote) throw new Error(`no ${mode} quote to ${to}`);
  const seen = sight ?? sightOf(state, world, state.player);
  const risks = tradeRisk(state, seen, [roma, other], mode === 'land' ? quote.path : undefined);
  return {
    lines: risks.map((risk) => riskText(state, risk)),
    mark: riskMark(state, risks),
    payback: paybackText(state, quote.paybackDays, risks),
    quote,
  };
}

const atWar = (state: GameState, a: typeof f.rome, b: typeof f.rome) => {
  state.wars[warKey(a, b)] = newWar(a, b, state.day);
};

describe('the risk a quote tells', () => {
  test('a peaceful route says nothing threatens it beside its payback', () => {
    const { lines, mark, payback, quote } = read(buildFixture(), f.syracusae, 'sea');
    expect(lines).toEqual([]);
    expect(mark).toBe('');
    expect(payback).toBe(
      `pays back in ${(quote.paybackDays / 365).toFixed(1)} years; no war or siege threatens it now.`,
    );
  });

  test("the partner's war says the route closes if the city changes hands, and ships face no raids", () => {
    const state = buildFixture();
    atWar(state, f.carthage, f.syracusaeFaction);
    const { lines, mark, payback } = read(state, f.syracusae, 'sea');
    expect(lines).toEqual([
      'Syracusae is at war with Carthage: if Syracusae changes hands, the route closes.',
    ]);
    expect(mark).toBe('Syracusae at war');
    expect(payback).toMatch(/^pays back in \d\.\d years; Syracusae is at war with Carthage/);
  });

  test('a road in a war of yours may be raided, and an enemy army near it counts only while in sight', () => {
    const state = buildFixture();
    atWar(state, f.rome, f.carthage);
    expect(read(state, f.capua, 'land').lines).toEqual([
      'Carthage could raid this road and take its cargo.',
      'You are at war with Carthage: if Roma falls, the route closes.',
      'You are at war with Carthage: if Capua falls, the route closes.',
    ]);
    const army = state.armies[f.punicArmy];
    const { quote } = read(state, f.capua, 'land');
    const middle = quote.path[Math.floor(quote.path.length / 2)];
    if (!army || !middle) throw new Error('missing army or road');
    army.activity = { kind: 'idle', position: { ...middle } };
    const seen = read(state, f.capua, 'land');
    expect(seen.lines).toContain(
      'Carthage could raid this road and take its cargo; one of their armies stands within 20 km of it now.',
    );
    expect(seen.mark).toBe('raiders near the road');
    const fogged = { ...sightOf(state, world, state.player), armies: new Set<never>() };
    expect(read(state, f.capua, 'land', fogged).lines).toContain(
      'Carthage could raid this road and take its cargo.',
    );
  });

  test('a besieged partner comes first, naming the besieger only while one is in sight', () => {
    const state = buildFixture();
    atWar(state, f.carthage, f.syracusaeFaction);
    const army = state.armies[f.punicArmy];
    if (!army) throw new Error('missing army');
    army.activity = { kind: 'idle', position: { ...city(state, f.syracusae).position } };
    const besieged = tick(state, [], world).state;
    expect(Object.values(besieged.sieges)).toHaveLength(1);
    const all = { ...sightOf(besieged, world, besieged.player), armies: new Set([f.punicArmy]) };
    const seen = read(besieged, f.syracusae, 'sea', all);
    expect(seen.lines[0]).toBe(
      'Syracusae is besieged by Carthage: deliveries stop while the siege lasts, and if Syracusae falls, the route closes.',
    );
    expect(seen.mark).toBe('Syracusae besieged');
    const none = { ...all, armies: new Set<never>() };
    expect(read(besieged, f.syracusae, 'sea', none).lines[0]).toBe(
      'Syracusae is besieged: deliveries stop while the siege lasts, and if Syracusae falls, the route closes.',
    );
  });

  test("a sea route to a peaceful partner still tells the player's own war", () => {
    const state = buildFixture();
    atWar(state, f.rome, f.syracusaeFaction);
    const { lines, mark, payback } = read(state, f.carthago, 'sea');
    expect(lines).toEqual(['You are at war with Syracusae: if Roma falls, the route closes.']);
    expect(mark).toBe('you are at war');
    expect(payback).not.toContain('no war or siege threatens it now');
  });

  test('a leagued minor whose partner is at war with you will join, which closes the route', () => {
    const state = buildFixture();
    const syracusae = state.factions[f.syracusaeFaction];
    const carthage = state.factions[f.carthage];
    if (!syracusae || !carthage) throw new Error('missing factions');
    syracusae.league = f.carthage;
    carthage.league = f.syracusaeFaction;
    atWar(state, f.rome, f.carthage);
    const { lines, mark } = read(state, f.syracusae, 'sea');
    expect(lines).toEqual([
      "Syracusae's league partner Carthage is at war with you, and Syracusae will join that war, which closes the route.",
      'You are at war with Carthage: if Roma falls, the route closes.',
    ]);
    expect(mark).toBe('Syracusae joins a war on you');
  });
});
