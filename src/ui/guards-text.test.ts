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
import { GUARD_DAYS } from '../sim/guards.ts';
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
          `^Carthage ${now}% of the strength it needs to declare war, still at 80% or more, so it may still declare once it has stood at 80% for 30 days\\. One more band, counted until ${dateText(state.day + 90)}, takes it to (\\d+)%; \\d bands, [\\d,]+ gold, take it to \\d+%, below 80%, so it may not declare until it has stood at 80% for 30 days\\.$`,
        ),
      ),
    ]);
    const after = Number(/takes it to (\d+)%/.exec(shown.hire.threats[0] ?? '')?.[1]);
    expect(after).toBeLessThan(now);
  });
});

describe('a band that does not take a power off notice', () => {
  const map = parseMap(
    JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
  );
  const atlas = buildWorld(map);

  /** Carthage of twelve cities with `men` beside Rome's 4,000 and full treasury on day 100, on notice since day 80. */
  function carthageAt(men: number): GameState {
    const state = newGame(map, { seed: 1, player: 'rome' });
    state.day = 100 as Day;
    for (const id of WEST) changeCityOwner(state, id, carthage);
    for (const faction of Object.values(state.factions))
      if (faction.kind === 'minor')
        state.truces[warKey(carthage, faction.id)] = {
          since: state.day,
          endsOn: (state.day + 365) as Day,
        };
    for (const army of Object.values(state.armies)) {
      const spearmen = state.formations[army.formations[0] as never];
      if (spearmen && army.owner === carthage) spearmen.men = men;
      if (spearmen && army.owner === f.rome) spearmen.men = 4000;
    }
    const rome = state.factions[f.rome];
    const punic = state.factions[carthage];
    if (!rome || !punic) throw new Error('no Rome or Carthage');
    rome.stores.gold = limitsOf(state).get(f.rome)?.gold ?? 0;
    punic.noticeSince = 80 as Day;
    return state;
  }
  const roma = (state: GameState) => {
    const city = state.cities['roma' as CityId];
    if (!city) throw new Error('no Roma');
    return city;
  };
  const hireAtRoma: Order = { kind: 'hireGuards', faction: f.rome, city: 'roma' as CityId };
  const afterHire = (state: GameState) => {
    const hired = structuredClone(state);
    executeOrder(hired, hireAtRoma, atlas);
    return hired;
  };

  it('says, before and after the hire, that the power may still declare from its named day', () => {
    const state = carthageAt(6000);
    expect(warReadiness(state, atlas, carthage, f.rome)?.readiness).toBeGreaterThanOrEqual(1);
    expect(cityGuards(state, [], roma(state), atlas).hire.threats).toEqual([
      'Carthage 100% of the strength it needs to declare war, still at 80% or more, so it may still declare from Year 1, day 110. One more band, counted until Year 1, day 190, takes it to 88%; 2 bands, 4,000 gold, take it to 78%, below 80%, so it may not declare until it has stood at 80% for 30 days.',
    ]);
    expect(cityGuards(state, [hireAtRoma], roma(state), atlas).hire.threats).toEqual([
      'Carthage, with the band you hired: 88% of the strength it needs to declare war, still at 80% or more, so it may still declare from Year 1, day 110. One more band, counted until Year 1, day 190, takes it to 78%, below 80%, so it may not declare until it has stood at 80% for 30 days.',
    ]);
  });

  it('reckons the band you hired on the gold you hold, not the gold one more band would need', () => {
    const state = carthageAt(6360);
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('no Rome');
    rome.stores.gold = 3000;
    const hired = afterHire(state);
    const real = warReadiness(hired, atlas, carthage, f.rome)?.readiness ?? 1;
    expect(real).toBeLessThan(0.8);
    const [line] = cityGuards(state, [hireAtRoma], roma(state), atlas).hire.threats;
    expect(line).toMatch(
      new RegExp(`^Carthage, with the band you hired: ${Math.round(real * 100)}% `),
    );
  });

  it('still says the band you hired is not enough when no more can be hired', () => {
    const state = carthageAt(8000);
    const city = roma(state);
    city.guards = Array.from({ length: 5 }, () => band(465));
    const shown = cityGuards(state, [hireAtRoma], city, atlas);
    expect(shown.hire.why).toBe('Roma holds 3,000 guards, and 3,000 is the most it can');
    expect(shown.hire.threats).toEqual([
      'Carthage, with the band you hired: 100% of the strength it needs to declare war, still at 80% or more, so it may still declare from Year 1, day 110. Roma holds the most guards it may: guards alone cannot take it below 80%.',
    ]);
    city.guards.push(band(465));
    expect(cityGuards(state, [], city, atlas).hire.threats).toEqual([
      'Carthage 100% of the strength it needs to declare war, still at 80% or more, so it may still declare from Year 1, day 110. Roma holds the most guards it may: guards alone cannot take it below 80%.',
    ]);
  });

  it('calls a share that rounds up to 80% but is below it just under 80%', () => {
    const state = carthageAt(5400);
    const [line] = cityGuards(state, [], roma(state), atlas).hire.threats;
    expect(line).toContain(
      'takes it to just under 80%, so it may not declare until it has stood at 80% for 30 days.',
    );
    expect(line).not.toContain('takes it to 80%');
  });

  it('says, at the most guards a city may hold, that guards alone cannot take it below 80%', () => {
    const state = carthageAt(8000);
    expect(cityGuards(state, [hireAtRoma], roma(state), atlas).hire.threats).toEqual([
      'Carthage, with the band you hired: 100% of the strength it needs to declare war, still at 80% or more, so it may still declare from Year 1, day 110. One more band, counted until Year 1, day 190, takes it to 100%, and all 5 bands Roma may still hire, 10,000 gold, take it to 97%: guards alone cannot take it below 80%.',
    ]);
    const full = carthageAt(8000);
    roma(full).guards = Array.from({ length: 4 }, () => band(465));

    expect(cityGuards(full, [hireAtRoma], roma(full), atlas).hire.threats).toEqual([
      expect.stringMatching(
        /^Carthage, with the band you hired: 100% .*\. One more band, counted until Year 1, day 190 and the last Roma may hold, takes it to 100%: guards alone cannot take it below 80%\.$/,
      ),
    ]);
  });

  it('counts the bands a full city may hire in place of those no great power counts', () => {
    const state = carthageAt(8000);
    roma(state).guards = Array.from({ length: 6 }, () => band(300));
    const tail = (bands: number) =>
      `and all ${bands} bands Roma may still hire, ${(bands * 2).toLocaleString('en-GB')},000 gold, take it no lower: guards alone cannot take it below 80%.`;
    const [now] = cityGuards(state, [], roma(state), atlas).hire.threats;
    expect(now?.endsWith(tail(6))).toBe(true);
    expect(now).not.toContain('holds the most guards it may');
    const [hired] = cityGuards(state, [hireAtRoma], roma(state), atlas).hire.threats;
    expect(hired).toMatch(/^Carthage, with the band you hired: /);
    expect(hired?.endsWith(tail(5))).toBe(true);
  });

  it('says no lower when the bands a city may still hire leave the share where one more takes it', () => {
    const state = carthageAt(8000);
    expect(cityGuards(state, [hireAtRoma, hireAtRoma], roma(state), atlas).hire.threats).toEqual([
      expect.stringMatching(
        /^Carthage, with the 2 bands you hired: .* One more band, counted until Year 1, day 190, takes it to (\d+)%, and all 4 bands Roma may still hire, 8,000 gold, take it no lower: guards alone cannot take it below 80%\.$/,
      ),
    ]);
  });

  it('says how many bands take a capped share below 80%, as the rules count them', () => {
    const state = carthageAt(6000);
    const [line] = cityGuards(state, [], roma(state), atlas).hire.threats;
    const bands = Number(/; (\d) bands, /.exec(line ?? '')?.[1]);
    let hired = state;
    for (let band = 0; band < bands; band++) hired = afterHire(hired);
    const share = warReadiness(hired, atlas, carthage, f.rome)?.readiness ?? 1;
    expect(share).toBeLessThan(0.8);
    expect(
      warReadiness(afterHire(state), atlas, carthage, f.rome)?.readiness,
    ).toBeGreaterThanOrEqual(0.8);
    expect(line).toContain(`take it to ${Math.round(share * 100)}%, below 80%`);
  });

  it('names the bands hired today, not one band, after two hires in a day', () => {
    const state = carthageAt(8000);
    const [line] = cityGuards(state, [hireAtRoma, hireAtRoma], roma(state), atlas).hire.threats;
    expect(line).toMatch(/^Carthage, with the 2 bands you hired: /);
    expect(line).not.toContain('the band you hired');
  });

  it('says once in a line that the power may still declare from its day', () => {
    for (const men of [5300, 5400, 6000, 6360, 8000, 12_000])
      for (const pending of [[], [hireAtRoma], [hireAtRoma, hireAtRoma]]) {
        const state = carthageAt(men);
        for (const line of cityGuards(state, pending, roma(state), atlas).hire.threats)
          expect(line.split('may still declare').length - 1, `${men}: ${line}`).toBeLessThanOrEqual(
            1,
          );
      }
  });

  it('writes a share just under 80% the same way before and after the hire', () => {
    const state = carthageAt(5400);
    const [before] = cityGuards(state, [], roma(state), atlas).hire.threats;
    expect(before).toContain('takes it to just under 80%');
    const [after] = cityGuards(state, [hireAtRoma], roma(state), atlas).hire.threats;
    expect(after).toMatch(
      /^Carthage just under 80% → \d+% of the strength it needs to declare war/,
    );
  });

  it('says one band that is enough takes it below 80%, and keeps the arrow once it stands below', () => {
    const state = carthageAt(5300);
    expect(cityGuards(state, [], roma(state), atlas).hire.threats).toEqual([
      'Carthage 90% of the strength it needs to declare war. One more band, counted until Year 1, day 190, takes it to 78%, below 80%, so it may not declare until it has stood at 80% for 30 days.',
    ]);
    expect(cityGuards(state, [hireAtRoma], roma(state), atlas).hire.threats).toEqual([
      'Carthage 78% → 69% of the strength it needs to declare war, until Year 1, day 190',
    ]);
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

describe('a power the guards at its front turn to the field armies', () => {
  it('keeps the city the warning weighed, and says the guards took the power off it', () => {
    const realWorld = fixtureWorld();
    const state = newGame(realWorld.map, { seed: 1, player: 'rome' });
    for (const faction of Object.values(state.factions))
      if (faction.kind === 'minor')
        state.truces[warKey(carthage, faction.id)] = {
          since: state.day,
          endsOn: (state.day + 365) as Day,
        };
    const punic = Object.values(state.armies).find((army) => army.owner === carthage);
    const spearmen = punic && state.formations[punic.formations[0] as never];
    const romans = state.factions['rome' as FactionId];
    if (!spearmen || !romans) throw new Error('no records');
    spearmen.men = 2200;
    romans.stores.gold = 20_000;
    for (const city of Object.values(state.cities))
      if (city.owner === romans.id) city.garrison = 80_000;
    const capua = state.cities['capua' as CityId];
    if (!capua) throw new Error('no Capua');
    capua.garrison = 800;
    const warned = warReadiness(state, realWorld, carthage, romans.id);
    if (!warned || warned.pressed || warned.front !== capua.id)
      throw new Error('Carthage does not weigh Capua');
    const hireAtCapua: Order = { kind: 'hireGuards', faction: romans.id, city: capua.id };
    const [line] = cityGuards(state, [hireAtCapua], capua, realWorld).hire.threats;
    expect(line).toBe(
      'Carthage, with the band you hired: 85% of the strength it needs to declare war, still at 80% or more, so it may still declare once it has stood at 80% for 30 days. The guards took it off Capua, where without them it would stand at 95%: it now weighs your field armies, and more guards do not lower that.',
    );
    const hired = structuredClone(state);
    executeOrder(hired, hireAtCapua, realWorld);
    const [later] = cityGuards(hired, [], hired.cities[capua.id] ?? capua, realWorld).hire.threats;
    expect(later).toContain(
      'The guards took it off Capua, where without them it would stand at 95%',
    );
  });
});

describe('a power that presses by its field armies, at a city it does not weigh', () => {
  it("is named in every city's section, so no hire there looks like an answer to it", () => {
    const realWorld = fixtureWorld();
    const state = newGame(realWorld.map, { seed: 1, player: 'rome' });
    const carthage = 'carthage' as FactionId;
    for (const faction of Object.values(state.factions))
      if (faction.kind === 'minor')
        state.truces[warKey(carthage, faction.id)] = {
          since: state.day,
          endsOn: (state.day + 365) as Day,
        };
    const punic = Object.values(state.armies).find((army) => army.owner === carthage);
    const spearmen = punic && state.formations[punic.formations[0] as never];
    const roma = state.cities['roma' as CityId];
    const capua = state.cities['capua' as CityId];
    const romans = state.factions['rome' as FactionId];
    if (!spearmen || !roma || !capua || !romans) throw new Error('no records');
    spearmen.men = 8000;
    roma.garrison = 80_000;
    capua.garrison = 80_000;
    romans.stores.gold = 20_000;
    const threat = warReadiness(state, realWorld, carthage, 'rome' as FactionId);
    if (!threat?.pressed) throw new Error('Carthage does not press Rome');
    const elsewhere = threat.front === capua.id ? roma : capua;
    expect(cityGuards(state, [], elsewhere, realWorld).hire.threats).toContain(
      `Carthage ${Math.round(Math.min(1, threat.readiness) * 100)}% of the strength it needs to declare war, by its field armies against yours: guards do not hold that back`,
    );
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

  it('under Long contracts, counts a waiting hire that replaces an 18-month band, and names the day the next one would have left', () => {
    const state = withGold(5000);
    const rome = state.factions[f.rome];
    const roma = state.cities[f.roma];
    if (!rome || !roma) throw new Error('no Rome');
    rome.advances = ['longContracts'];
    const term = Math.round(GUARD_DAYS * 1.5);
    const hired = (day: number) => ({ until: (day + term) as Day, hiredOn: day as Day });
    roma.guards = [
      hired(state.day - 100),
      hired(state.day - 95),
      ...Array.from({ length: 4 }, () => hired(state.day - 10)),
    ];
    expect(shown(state, [hire])).toMatchObject({
      line: expect.stringContaining('500 more hired for the next day'),
      hire: {
        change: `Takes the place of the 500 who leave ${dateText(state.day - 95 + term)}, whom no great power still counts`,
      },
    });
  });

  it('offers a full city a band in the place of one no great power still counts', () => {
    const state = withGold(5000);
    const roma = state.cities[f.roma];
    if (!roma) throw new Error('no Roma');
    roma.guards = [
      band(state.day + 200),
      ...Array.from({ length: 5 }, () => band(state.day + 360)),
    ];
    expect(shown(state).hire).toMatchObject({
      why: undefined,
      change: `Takes the place of the 500 who leave ${dateText(state.day + 200)}, whom no great power still counts`,
    });
    expect(shown(state, [hire]).line).toBe(
      `3,000 guards · 500 leave ${dateText(state.day + 200)}, 2,500 leave ${dateText(state.day + 360)} · 500 more hired for the next day`,
    );
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
