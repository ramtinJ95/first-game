import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances } from '../sim/systems/economy.ts';
import { signed } from './describe.ts';
import { cityGuards, guardsLine } from './guards-text.ts';

const world = fixtureWorld();
const hire: Order = { kind: 'hireGuards', faction: f.rome, city: f.roma };

function withGold(gold: number): GameState {
  const state = buildFixture();
  const rome = state.factions[f.rome];
  if (rome) rome.stores.gold = gold;
  return state;
}

function shown(state: GameState, pending: Order[] = []) {
  const roma = state.cities[f.roma];
  if (!roma) throw new Error('no Roma');
  return cityGuards(state, pending, roma, world);
}

describe('guardsLine', () => {
  it('says the guards held, their daily gold, and what the next day changes', () => {
    expect(guardsLine(0, 0)).toBe('No guards hired');
    expect(guardsLine(500, 0)).toBe('500 guards · 10 gold a day');
    expect(guardsLine(495, 0)).toBe('495 guards · 9.9 gold a day');
    expect(guardsLine(0, 500)).toBe('No guards hired · 500 more hired for the next day');
    expect(guardsLine(1000, -500)).toBe(
      '1,000 guards · 20 gold a day · 500 dismissed for the next day',
    );
  });
});

describe('cityGuards', () => {
  it("gives a hire's garrison and the realm's gold a day before and after, from the rules", () => {
    const state = withGold(5000);
    const now = dailyBalances(state).get(f.rome)?.gold ?? 0;
    expect(shown(state)).toEqual({
      line: 'No guards hired',
      hire: {
        gold: 1500,
        change: `Garrison 3,000 → 3,500 · gold ${signed(now)} → ${signed(now - 10)} a day`,
        why: undefined,
      },
      dismiss: undefined,
    });
  });

  it('counts a hire waiting for the next day, its gold already spent', () => {
    const state = withGold(2000);
    const after = shown(state, [hire]);
    expect(after.line).toBe('No guards hired · 500 more hired for the next day');
    expect(after.hire.change).toMatch(/^Garrison 3,500 → 4,000 /);
    expect(after.hire.why).toBe('Needs 1,000 more gold');
    expect(after.dismiss).toBe(500);
  });

  it('says in words why a hire is refused', () => {
    const state = withGold(5000);
    const roma = state.cities[f.roma];
    if (!roma) throw new Error('no Roma');
    roma.unrestDays = 30;
    expect(shown(state).hire).toMatchObject({
      why: 'Roma is in unrest for 30 more days',
      change: undefined,
    });
    roma.unrestDays = 0;
    roma.guards = 3000;
    expect(shown(state).hire.why).toBe('Roma holds 3,000 guards, and 3,000 is the most it can');
    expect(shown(state).dismiss).toBe(500);
  });
});
