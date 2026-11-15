import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { cityGuards, guardsLine } from './guards-text.ts';

const world = fixtureWorld();
const hire: Order = { kind: 'hireGuards', faction: f.rome, city: f.roma };
const band = (until: number) => ({ until: until as Day });

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
  it('says the guards held, the day each band leaves, and what the next day hires', () => {
    expect(guardsLine([], 0)).toBe('No guards hired');
    expect(guardsLine([band(770), band(831)], 0)).toBe(
      '1,000 guards · 500 leave Year 3, day 40, 500 leave Year 3, day 101',
    );
    expect(guardsLine([band(770), band(770)], 0)).toBe('1,000 guards · 1,000 leave Year 3, day 40');
    expect(guardsLine([], 1)).toBe('No guards hired · 500 more hired for the next day');
  });
});

describe('cityGuards', () => {
  it("gives a hire's price and the garrison before and after, from the rules", () => {
    expect(shown(withGold(5000))).toEqual({
      line: 'No guards hired',
      hire: { gold: 2000, change: 'Garrison 3,000 → 3,500', why: undefined },
    });
  });

  it('counts a hire waiting for the next day, its gold already spent', () => {
    const after = shown(withGold(3000), [hire]);
    expect(after.line).toBe('No guards hired · 500 more hired for the next day');
    expect(after.hire.change).toBe('Garrison 3,500 → 4,000');
    expect(after.hire.why).toBe('Needs 1,000 more gold');
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
    roma.guards = Array.from({ length: 6 }, () => band(400));
    expect(shown(state).hire.why).toBe('Roma holds 3,000 guards, and 3,000 is the most it can');
  });
});
