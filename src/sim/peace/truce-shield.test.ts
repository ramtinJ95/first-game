import { describe, expect, test } from 'vitest';
import { peaceAnswer, proposal, warDamage } from '../ai/peace.ts';
import { SMALL_LOSS_SHARE } from '../ai/thresholds.ts';
import { strengthOf } from '../ai/situation.ts';
import { changeCityOwner } from '../cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../fixture.ts';
import type { FactionId, SiegeId } from '../ids.ts';
import { leaveSiege } from '../armies.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import { newWar, warKey } from '../state/war.ts';
import { advanceDay } from '../systems/advance-day.ts';
import { tick } from '../tick.ts';
import { AS_THINGS_STAND, GOLD_PER_POINT } from './terms.ts';
import { warStanding } from './standing.ts';

const world = fixtureWorld();
const key = warKey(f.rome, f.carthage);

/** Equal troops/general/morale: 1,500 besiegers against a realm with 3,000 soldiers elsewhere. */
function standOff(day: number, lost = 0, seed = 1) {
  const state = buildFixture(seed);
  changeCityOwner(state, f.syracusae, f.carthage);
  const roman = state.armies[f.romanArmy];
  const enemy = state.armies[f.punicArmy];
  const cavalry = state.formations[f.equites];
  const spears = state.formations[f.citizenSpears];
  const city = state.cities[f.syracusae];
  if (!roman || !enemy || !cavalry || !spears || !city) throw new Error('fixture');
  cavalry.troop = 'spearmen';
  spears.men = 3000 - lost;
  spears.morale = 1;
  city.rank = 'greatPowerCity';
  const war = newWar(f.rome, f.carthage, 1 as Day);
  const side = war.sides[f.carthage];
  if (!side) throw new Error('fixture');
  side.lost = lost;
  state.wars[key] = war;
  state.day = day as Day;
  const siege = 'siege-shield' as SiegeId;
  state.sieges[siege] = {
    id: siege,
    city: city.id,
    besiegers: [roman.id],
    startedOn: Math.max(1, day - 4) as Day,
  };
  roman.activity = { kind: 'besieging', siege, position: { ...city.position } };
  expectConsistent(state);
  return state;
}

function twoFronts(romanLoss: number, punicLoss: number, otherLoss = 0) {
  const state = standOff(62, punicLoss, 30);
  const army = state.armies[f.romanArmy];
  const side = state.wars[key]?.sides[f.rome];
  const foot = state.formations[f.hastati];
  const punic = state.factions[f.carthage];
  if (!army || !side || !foot || !punic) throw new Error('fixture');
  leaveSiege(state, army);
  side.lost = romanLoss;
  foot.men -= romanLoss;
  const egypt = 'egypt' as FactionId;
  state.factions[egypt] = {
    ...punic,
    id: egypt,
    name: 'Egypt',
    stores: { gold: 1000, food: 1000, manpower: 1000 },
  };
  changeCityOwner(state, f.syracusae, egypt);
  const other = newWar(egypt, f.carthage, 1 as Day);
  const losses = other.sides[f.carthage];
  const spears = state.formations[f.citizenSpears];
  if (!losses || !spears) throw new Error('fixture');
  losses.lost = otherLoss;
  spears.men -= otherLoss;
  state.wars[warKey(f.carthage, egypt)] = other;
  expectConsistent(state);
  return state;
}

describe('peace cannot turn a token war into a free truce shield', () => {
  test.each([0, 72])(
    'a winning second-front AI still charges after 151 Roman losses and %i of its own',
    (lost) => {
      for (const roman of [150, 151]) {
        const state = twoFronts(roman, lost);
        const answer = peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND);
        expect(answer?.accepts).toBe(false);
        expect(answer?.short).toBeGreaterThan(0);
        expectConsistent(state);
      }
      const state = twoFronts(151, lost);
      expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.verdict).toContain(
        'worth 1 point more',
      );
      expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.wish.factors).toContainEqual(
        expect.objectContaining({ kind: 'otherWars', text: 'Carthage is also at war with Egypt' }),
      );
      const payment = { kind: 'payment', payer: f.rome, gold: 100, cities: [] } as const;
      expect(peaceAnswer(state, f.carthage, f.rome, payment)?.accepts).toBe(true);
      expect(peaceAnswer(state, f.carthage, f.rome, { ...payment, gold: 99 })?.accepts).toBe(false);
    },
  );

  test('only real losses on the other front remove the early positive-price floor', () => {
    for (const losses of [0, 300, 301]) {
      const state = twoFronts(0, 0, losses);
      expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(losses > 300);
      expectConsistent(state);
    }
  });

  test('a held city loss on the other front can justify free peace, but equal battle losses cannot', () => {
    const state = twoFronts(151, 72);
    const egypt = 'egypt' as FactionId;
    changeCityOwner(state, f.capua, egypt);
    changeCityOwner(state, f.syracusae, f.carthage);
    changeCityOwner(state, f.carthago, egypt);
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(true);
    expectConsistent(state);
    const even = twoFronts(151, 0, 301);
    const other = even.wars[warKey(f.carthage, egypt)]?.sides[egypt];
    if (!other) throw new Error('fixture');
    other.lost = 301;
    expect(peaceAnswer(even, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(false);
    expectConsistent(even);
  });

  test('the seed-30 casualty record buys a truce for 100 gold, not for the player’s 151 casualties alone', () => {
    const state = twoFronts(151, 72);
    const before = state.factions[f.rome]?.stores.gold;
    const terms = { kind: 'payment', payer: f.rome, gold: 100, cities: [] } as const;
    const sent = tick(
      state,
      [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: { ...terms, cities: [] } }],
      world,
      [advanceDay],
    );
    const made = tick(
      sent.state,
      [
        {
          kind: 'acceptPeace',
          faction: f.carthage,
          from: f.rome,
          terms: { ...terms, cities: [] },
          reckon: true,
        },
      ],
      world,
      [advanceDay],
    );
    expect(sent.rejected).toEqual([]);
    expect(made.rejected).toEqual([]);
    expect(made.state.factions[f.rome]?.stores.gold).toBe((before ?? 0) - 100);
    expect(made.state.truces[key]).toEqual({ since: 63, endsOn: 428 });
    expectConsistent(made.state);
  });

  test('an exposed city under siege is provisional pressure, not a real defeat', () => {
    const state = standOff(69);
    const own = state.armies[f.romanArmy];
    const enemy = state.armies[f.punicArmy];
    if (!own || !enemy) throw new Error('fixture');
    expect(strengthOf(state, enemy) / strengthOf(state, own)).toBeCloseTo(2, 12);
    expect(warStanding(state, f.carthage, f.rome)?.score).toBe(-7);
    const answer = peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND);
    expect(answer).toMatchObject({ accepts: false, short: 11 });
    expect(answer?.wish.factors).toContainEqual(
      expect.objectContaining({
        kind: 'restraint',
        points: -7,
        text: expect.stringContaining('waits 225 days'),
      }),
    );
    expectConsistent(state);
  });

  test.each([0, 1, 66, 150, 300])(
    'losing %i of 3,000 soldiers is no more than the small-share boundary',
    (lost) => {
      const state = standOff(69, lost);
      const standing = warStanding(state, f.carthage, f.rome);
      if (!standing) throw new Error('no war');
      expect(warDamage(state, standing).ownShare).toBeLessThanOrEqual(SMALL_LOSS_SHARE);
      expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(false);
      expectConsistent(state);
    },
  );

  test('301 real casualties exceed the 10% boundary; a clearly beaten side can then take white peace', () => {
    const state = standOff(69, 301);
    const standing = warStanding(state, f.carthage, f.rome);
    if (!standing) throw new Error('no war');
    expect(warDamage(state, standing)).toMatchObject({ even: false, losing: true });
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(true);
    expectConsistent(state);
  });

  test('a recruiting realm that crosses back below the loss threshold explains the changed forecast', () => {
    const state = standOff(69, 301);
    const sent = tick(
      state,
      [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: AS_THINGS_STAND }],
      world,
      [
        (next) => {
          const formation = next.formations[f.citizenSpears];
          if (!formation) throw new Error('fixture');
          formation.men += 1000;
        },
        advanceDay,
      ],
    );
    const result = tick(
      sent.state,
      [{ kind: 'refusePeace', faction: f.carthage, from: f.rome, reckon: true }],
      world,
      [advanceDay],
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceRefused',
        reason: expect.stringContaining(
          'its surviving forces changed; its recorded losses no longer exceed 10%',
        ),
      }),
    );
    expectConsistent(result.state);
  });

  test('equal substantial losses do not let a siege alone manufacture a losing side', () => {
    const state = standOff(69, 301);
    const own = state.wars[key]?.sides[f.rome];
    if (!own) throw new Error('no war');
    own.lost = 301;
    const standing = warStanding(state, f.carthage, f.rome);
    if (!standing) throw new Error('no war');
    expect(warDamage(state, standing).losing).toBe(false);
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(false);
    expectConsistent(state);
  });

  test("sacrificing the player's men does not turn pressure on an undamaged capital into free peace", () => {
    const state = standOff(69);
    const own = state.wars[key]?.sides[f.rome];
    const soldiers = state.formations[f.hastati];
    const city = state.cities[f.syracusae];
    if (!own || !soldiers || !city) throw new Error('fixture');
    own.lost = 151;
    soldiers.men -= 151;
    city.rank = 'capital';
    const standing = warStanding(state, f.carthage, f.rome);
    if (!standing) throw new Error('no war');
    expect(warDamage(state, standing)).toMatchObject({
      even: false,
      losing: false,
      durableScore: 2,
    });
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)).toMatchObject({
      accepts: false,
      short: 13,
    });
    expectConsistent(state);
  });

  test('other wars and empty stores cannot disguise an unbloodied war as a defeat', () => {
    const state = standOff(69);
    const side = state.factions[f.carthage];
    if (!side) throw new Error('fixture');
    side.stores.food = -1;
    const egypt = 'egypt' as FactionId;
    state.factions[egypt] = {
      ...side,
      id: egypt,
      name: 'Egypt',
      stores: { gold: 1000, food: 1000, manpower: 1000 },
    };
    changeCityOwner(state, f.capua, egypt);
    state.wars[warKey(f.carthage, egypt)] = newWar(egypt, f.carthage, state.day);
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(false);
    expectConsistent(state);
  });

  test('taking and holding a real city can win an earlier free peace, but not merely besieging it', () => {
    const state = standOff(69);
    // The capture system removes the completed siege before changing the city owner.
    const army = state.armies[f.romanArmy];
    if (!army || army.activity.kind !== 'besieging') throw new Error('fixture');
    leaveSiege(state, army);
    changeCityOwner(state, f.syracusae, f.rome);
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(true);
    expectConsistent(state);
  });

  test('the cheapest undamaged war against twice the strength: 1,100 gold at first talks, or 225 days for a free exit', () => {
    const frontier = Array.from({ length: 166 }, (_, i) => {
      const day = 61 + i;
      const state = standOff(day);
      const answer = peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND);
      return { day, gold: (answer?.short ?? Infinity) * GOLD_PER_POINT };
    });
    expect(frontier[0]).toEqual({ day: 61, gold: 1100 });
    expect(frontier.find((point) => point.gold === 0)).toEqual({ day: 226, gold: 0 });
    expect(frontier.find((point) => point.day === 225)).toEqual({ day: 225, gold: 100 });
    const mature = standOff(226);
    expect(proposal(mature, f.carthage, f.rome)).toEqual(AS_THINGS_STAND);
    const state = standOff(61);
    const terms = { kind: 'payment', payer: f.rome, gold: 1100, cities: [] } as const;
    expect(peaceAnswer(state, f.carthage, f.rome, terms)?.accepts).toBe(true);
    expect(peaceAnswer(state, f.carthage, f.rome, { ...terms, gold: 1099 })?.accepts).toBe(false);
    const before = state.factions[f.rome]?.stores.gold ?? 0;
    const sent = tick(
      state,
      [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: { ...terms, cities: [] } }],
      world,
      [advanceDay],
    );
    const made = tick(
      sent.state,
      [
        {
          kind: 'acceptPeace',
          faction: f.carthage,
          from: f.rome,
          terms: { ...terms, cities: [] },
          reckon: true,
        },
      ],
      world,
      [advanceDay],
    );
    expect(made.rejected).toEqual([]);
    expect(made.state.factions[f.rome]?.stores.gold).toBe(before - 1100);
    expect(made.state.truces[key]).toMatchObject({ since: 62, endsOn: 427 });
    expectConsistent(made.state);
  });

  test('an early zero-gold route requires a real gain: taking an undefended minor city costs this 1,500-man army 300 garrison men', () => {
    const state = standOff(61);
    const city = state.cities[f.syracusae];
    if (!city) throw new Error('fixture');
    city.rank = 'minorCity';
    city.walls = 0;
    city.garrison = 0;
    const sent = tick(
      state,
      [
        { kind: 'storm', faction: f.rome, city: city.id },
        { kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: AS_THINGS_STAND },
      ],
      world,
      [advanceDay],
    );
    expect(sent.rejected).toEqual([]);
    expect(sent.state.cities[city.id]?.owner).toBe(f.rome);
    expect(sent.state.cities[city.id]?.garrison).toBe(300);
    const remaining = Object.values(sent.state.formations)
      .filter((formation) => sent.state.armies[formation.army]?.owner === f.rome)
      .reduce((men, formation) => men + formation.men, 0);
    expect(remaining).toBe(1200);
    expect(peaceAnswer(sent.state, f.carthage, f.rome, AS_THINGS_STAND)?.accepts).toBe(true);
    const made = tick(
      sent.state,
      [
        {
          kind: 'acceptPeace',
          faction: f.carthage,
          from: f.rome,
          terms: AS_THINGS_STAND,
          reckon: true,
        },
      ],
      world,
      [advanceDay],
    );
    expect(made.rejected).toEqual([]);
    expect(made.state.truces[key]).toMatchObject({ since: 62, endsOn: 427 });
    expect(made.state.factions[f.rome]?.stores.gold).toBe(state.factions[f.rome]?.stores.gold);
    expectConsistent(made.state);
  });
});
