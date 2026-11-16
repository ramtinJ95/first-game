import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { readFileSync } from 'node:fs';
import { dateText } from '../app/names.ts';
import { warReadiness } from '../sim/ai/war.ts';
import { changeCityOwner } from '../sim/cities.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { buildWorld } from '../sim/world/world.ts';
import { cityGuards, guardsLine, weighedLine } from './guards-text.ts';

const carthage = 'carthage' as FactionId;
/** Eight minor cities west of Carthago, which grow Carthage to twelve, so Rome's full treasury tempts it. */
const WEST = [
  'caralis',
  'cirta',
  'iol-caesarea',
  'cidamus',
  'tarraco',
  'carthago-nova',
  'numantia',
  'burdigala',
] as CityId[];

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

describe('weighedLine', () => {
  it('says how many guards great powers still count against a war, and until when', () => {
    expect(weighedLine([], 100)).toBeUndefined();
    expect(weighedLine([band(500), band(500), band(530)], 100)).toBe(
      '1,000 count against a war until Year 1, day 225, 500 count against a war until Year 1, day 255',
    );
    expect(weighedLine([band(500)], 225)).toBe('None count against a war now');
  });
});

describe('the threat a hire answers', () => {
  const map = parseMap(
    JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
  );
  const atlas = buildWorld(map);

  it('names each great power that weighs the city, how near it stands to war now and with the band, and until when', () => {
    const state = newGame(map, { seed: 1, player: 'rome' });
    for (const id of WEST) changeCityOwner(state, id, carthage);
    for (const faction of Object.values(state.factions))
      if (faction.kind === 'minor')
        state.truces[warKey(carthage, faction.id)] = {
          since: state.day,
          endsOn: (state.day + 365) as Day,
        };
    for (const army of Object.values(state.armies)) {
      const spearmen = state.formations[army.formations[0] as never];
      if (spearmen && army.owner === carthage) spearmen.men = 6500;
      if (spearmen && army.owner === f.rome) spearmen.men = 4000;
    }
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('no Rome');
    rome.stores.gold = limitsOf(state).get(f.rome)?.gold ?? 0;
    const front = warReadiness(state, atlas, carthage, f.rome);
    const city = front && state.cities[front.front];
    if (!front || !city) throw new Error('no front');
    const shown = cityGuards(state, [], city, atlas);
    const now = Math.round(Math.min(1, front.readiness) * 100);
    expect(shown.hire.threats).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Carthage ${now}% → (\\d+)% of the strength it needs to declare war, until ${dateText(state.day + 90)}$`,
        ),
      ),
    ]);
    const after = Number(/→ (\d+)%/.exec(shown.hire.threats[0] ?? '')?.[1]);
    expect(after).toBeLessThan(now);
  });
});

describe('a threat guards cannot answer', () => {
  it('says so of a power drawn by rival pressure, which weighs field armies only', () => {
    const state = buildFixture();
    const hastati = state.formations[f.hastati];
    const spears = state.formations[f.citizenSpears];
    const carthaginians = state.factions[f.carthage];
    if (!hastati || !spears || !carthaginians) throw new Error('no fixture records');
    hastati.men = 2000;
    spears.men = 500;
    carthaginians.stores.gold = 5000;
    executeOrder(
      state,
      { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction },
      world,
    );
    state.player = f.carthage;
    const threat = warReadiness(state, world, f.rome, f.carthage);
    const city = threat && state.cities[threat.front];
    if (!threat?.pressed || !city) throw new Error('no pressure on Carthage');
    expect(cityGuards(state, [], city, world).hire.threats).toEqual([
      `Rome ${Math.round(Math.min(1, threat.readiness) * 100)}% of the strength it needs to declare war, by its field armies against yours: guards do not hold that back`,
    ]);
  });
});

describe('cityGuards', () => {
  it("gives a hire's price and the garrison before and after, from the rules", () => {
    expect(shown(withGold(5000))).toEqual({
      line: 'No guards hired',
      weighed: undefined,
      hire: { gold: 2000, change: 'Garrison 3,000 → 3,500', why: undefined, threats: [] },
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
