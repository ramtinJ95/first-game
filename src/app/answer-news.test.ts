import { describe, expect, it } from 'vitest';
import { decideAll } from '../sim/ai/decide.ts';
import { warReadiness } from '../sim/ai/war.ts';
import type { DayEvent } from '../sim/events.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { makePeace } from '../sim/peace/make-peace.ts';
import { tick } from '../sim/tick.ts';
import type { Alert } from './alerts.ts';
import { createAnswerNews } from './answer-news.ts';
import { dateText } from './names.ts';
import { share } from './threat-news.ts';

const world = fixtureWorld();
const carthage = f.carthage;

/** Carthage with `men` beside the fixture's Rome on day 100, on notice since day 80 and in a truce with Syracusae, so Rome is its one war. */
function carthageAt(men: number): GameState {
  const state = buildFixture();
  state.day = 100 as Day;
  state.truces[warKey(carthage, f.syracusaeFaction)] = {
    since: state.day,
    endsOn: (state.day + 3650) as Day,
  };
  const army = state.armies[f.punicArmy];
  const spearmen = army && state.formations[army.formations[0] as never];
  const punic = state.factions[carthage];
  if (!spearmen || !punic) throw new Error('no Carthage');
  spearmen.men = men;
  punic.noticeSince = 80 as Day;
  return state;
}

/** Carthage pressing the fixture's Rome of 300 spearmen and 100 horse by field armies, on notice since day 90, so a raised troop answers it. */
function pressedByField(): GameState {
  const start = carthageAt(900);
  const punic = start.factions[carthage];
  const army = start.armies[f.romanArmy];
  if (!punic || !army) throw new Error('no Carthage or Roman army');
  punic.noticeSince = 90 as Day;
  const [spears, horse] = army.formations.map((id) => start.formations[id]);
  if (!spears || !horse) throw new Error('no Roman formations');
  spears.men = 300;
  horse.men = 100;
  return start;
}

const raise: Order = { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' };

const hireAt = (city: CityId): Order => ({ kind: 'hireGuards', faction: f.rome, city });

/**
 * Plays the days as the clock does, the player's orders of each day first, and gives the answer
 * news of each. On `peaceOn` Carthage and Rome make peace as things stand before the day's tick.
 */
function play(
  start: GameState,
  days: number,
  ordersOn: (day: number) => Order[],
  peaceOn?: number,
  sees?: (state: GameState) => void,
) {
  const news = createAnswerNews(world);
  const told: Alert[] = [];
  const events: {
    day: number;
    events: readonly DayEvent[];
    owners: Map<CityId, FactionId>;
    readiness: number;
  }[] = [];
  let state = start;
  for (let i = 0; i < days; i++) {
    const made: DayEvent[] = [];
    if (state.day === peaceOn) {
      state = structuredClone(state);
      const terms = { kind: 'asThingsStand' } as const;
      makePeace(state, carthage, f.rome, terms);
      made.push({ kind: 'peaceMade', between: [carthage, f.rome], terms });
    }
    const orders = ordersOn(state.day);
    const result = tick(state, [...orders, ...decideAll(state, world)], world);
    const day = [...made, ...result.events];
    const taken = orders.filter((order) => !result.rejected.some((r) => r.order === order));
    news.onDay(state, result.state, day, taken);
    while (news.waiting) told.push(...news.next());
    const owners = new Map(Object.values(result.state.cities).map((c) => [c.id, c.owner]));
    const readiness = warReadiness(state, world, carthage, f.rome)?.readiness ?? 0;
    events.push({ day: state.day, events: day, owners, readiness });
    state = result.state;
    sees?.(state);
  }
  return { state, told, events };
}

const fellOn = (played: ReturnType<typeof play>, city: CityId) =>
  played.events.find(({ owners }) => owners.get(city) !== f.rome)?.day;

const declaredOn = (played: ReturnType<typeof play>, power: FactionId) =>
  played.events.find(({ events }) =>
    events.some((e) => e.kind === 'warDeclared' && e.by === power && e.against === f.rome),
  )?.day;

describe('the news of what an answer to a warning bought', () => {
  it('tells of a war that did not come on the day it could, which without the guards would have', () => {
    const start = carthageAt(2400);
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    const answer = (day: number) => (day === 100 ? [hireAt(front), hireAt(front)] : []);
    const answered = play(structuredClone(start), 12, answer);
    const ignored = play(structuredClone(start), 12, () => []);
    expect(declaredOn(ignored, carthage)).toBe(110);
    expect(declaredOn(answered, carthage)).toBeUndefined();
    const [line, ...more] = answered.told;
    expect(more).toEqual([]);
    expect(line?.day).toBe(110);
    expect(line?.text).toMatch(
      /^Carthage could have declared war on you today, as warned, and did not\. Without the 2 bands of guards you hired at Capua it would have: it stands at \d+% of the strength it needs, not \d+%\.$/,
    );
    const on110 = (played: ReturnType<typeof play>) =>
      share(played.events.find(({ day }) => day === 110)?.readiness ?? 0);
    expect(on110(answered)).not.toBe(on110(ignored));
    expect(line?.text).toContain(
      `it stands at ${on110(answered)} of the strength it needs, not ${on110(ignored)}.`,
    );
    expectConsistent(answered.state);
  });

  it('claims nothing for an answer the war did not wait on', () => {
    const start = carthageAt(3000);
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    const answered = play(structuredClone(start), 12, (day) =>
      day === 100 ? [hireAt(front)] : [],
    );
    expect(declaredOn(answered, carthage)).toBe(110);
    expect(answered.told).toEqual([]);
  });

  it('tells of a war that came later than it would have without the guards', () => {
    const start = carthageAt(2400);
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    const answer = (day: number) => (day === 100 ? [hireAt(front), hireAt(front)] : []);
    const answered = play(structuredClone(start), 130, answer);
    expect(
      declaredOn(
        play(structuredClone(start), 12, () => []),
        carthage,
      ),
    ).toBe(110);
    const later = declaredOn(answered, carthage);
    expect(later).toBeGreaterThan(110);
    expect(answered.told.map((a) => [a.day, a.text])).toEqual([
      [110, expect.stringMatching(/^Carthage could have declared war on you today/)],
      [
        later,
        `Carthage declared war ${(later ?? 0) - 110} days later than it would have without the 2 bands of guards you hired at Capua, which held it off from ${dateText(110)}.`,
      ],
    ]);
  });

  it('tells of a peace without the city the warning named, which without the guards would have fallen, crediting only the bands the rules took', () => {
    const start = carthageAt(3000);
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    const answer = (day: number) =>
      day === 100 ? [hireAt(front), hireAt(front), hireAt(front)] : [];
    const ignored = play(structuredClone(start), 100, () => []);
    const fell = fellOn(ignored, front);
    expect(declaredOn(ignored, carthage)).toBe(110);
    expect(fell).toBeDefined();
    const peaceOn = (fell ?? 0) + 5;
    const answered = play(structuredClone(start), peaceOn - 100 + 1, answer, peaceOn);
    expect(declaredOn(answered, carthage)).toBe(110);
    expect(answered.state.cities[front]?.owner).toBe(f.rome);
    expect(answered.told.map((a) => [a.day, a.text])).toEqual([
      [
        peaceOn,
        `Carthage made peace without taking Capua. Without the 2 bands of guards you hired at Capua it would have taken Capua on ${dateText(fell ?? 0)}.`,
      ],
    ]);
    expectConsistent(answered.state);
  });

  it('tells of a war a troop raised kept off, when the power weighs the field armies', () => {
    const start = pressedByField();
    expect(warReadiness(start, world, carthage, f.rome)?.pressed).toBe(true);
    const ignored = play(structuredClone(start), 25, () => []);
    const answered = play(structuredClone(start), 25, (day) => (day === 100 ? [raise] : []));
    expect(declaredOn(ignored, carthage)).toBe(120);
    expect(declaredOn(answered, carthage)).toBeUndefined();
    expect(answered.told.map((a) => [a.day, a.text])).toEqual([
      [
        120,
        expect.stringMatching(
          /^Carthage could have declared war on you today, as warned, and did not\. Without the Spearmen you raised it would have: /,
        ),
      ],
    ]);
  });

  it('claims nothing once an order names a record made after the answer, whose id differs without it', () => {
    const start = pressedByField();
    const rome = start.factions[f.rome];
    if (!rome) throw new Error('no Rome');
    rome.stores.gold = 20_000;
    const open: Order = {
      kind: 'openTrade',
      faction: f.rome,
      from: f.roma,
      to: f.capua,
      mode: 'land',
    };
    let route: string | undefined;
    const answered = play(
      structuredClone(start),
      25,
      (day) => {
        if (day === 100) return [raise];
        if (day === 116) return [open];
        return route && day === 118
          ? [{ kind: 'closeTrade', faction: f.rome, route } as Order]
          : [];
      },
      undefined,
      (state) => {
        route ??= Object.values(state.tradeRoutes).find((r) => r.owner === f.rome)?.id;
      },
    );
    expect(route).toBeDefined();
    expect(answered.state.tradeRoutes[route as never]).toBeUndefined();
    expect(declaredOn(answered, carthage)).toBeUndefined();
    expect(answered.told).toEqual([]);
  });

  it('keeps playing the game without the answer past the first day war may come', () => {
    const start = carthageAt(2300);
    const punic = start.factions[carthage];
    if (!punic) throw new Error('no Carthage');
    punic.noticeSince = 70 as Day;
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    const answer = (day: number) => (day === 100 ? [hireAt(front), hireAt(front)] : []);
    const ignored = play(structuredClone(start), 5, () => []);
    const answered = play(structuredClone(start), 130, answer);
    const without = declaredOn(ignored, carthage);
    const later = declaredOn(answered, carthage);
    expect(without).toBe(101);
    expect(later).toBeGreaterThan(200);
    expect(answered.told.at(-1)?.text).toBe(
      `Carthage declared war ${(later ?? 0) - 101} days later than it would have without the 2 bands of guards you hired at Capua, which held it off from ${dateText(101)}.`,
    );
  });

  it('tells of a war put off and then of a peace without the city, which without the guards fell first', () => {
    const start = carthageAt(2400);
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    const ignored = play(structuredClone(start), 110, () => []);
    const fell = fellOn(ignored, front);
    expect(declaredOn(ignored, carthage)).toBe(110);
    expect(fell).toBeDefined();
    const answer = (day: number) => (day === 100 ? [hireAt(front), hireAt(front)] : []);
    const war = declaredOn(play(structuredClone(start), 130, answer), carthage) ?? 0;
    expect(war).toBeGreaterThan(110);
    const peaceOn = Math.max(war, fell ?? 0) + 10;
    const answered = play(structuredClone(start), peaceOn - 100 + 1, answer, peaceOn);
    expect(answered.state.cities[front]?.owner).toBe(f.rome);
    expect(answered.told.map((a) => [a.day, a.text.split('.')[0]])).toEqual([
      [110, 'Carthage could have declared war on you today, as warned, and did not'],
      [
        war,
        `Carthage declared war ${war - 110} days later than it would have without the 2 bands of guards you hired at Capua, which held it off from Year 1, day 110`,
      ],
      [peaceOn, 'Carthage made peace without taking Capua'],
    ]);
    expect(answered.told.at(-1)?.text).toContain(
      `it would have taken Capua on ${dateText(fell ?? 0)}.`,
    );
  });

  it('plays the day without the answer only when asked, so the clock can give it a frame of its own', () => {
    const start = carthageAt(2400);
    const front = warReadiness(start, world, carthage, f.rome)?.front;
    if (!front) throw new Error('Carthage weighs no city of Rome');
    let decided = 0;
    const news = createAnswerNews(world, (state) => {
      decided++;
      return decideAll(state, world);
    });
    let state = start;
    for (let i = 0; i < 3; i++) {
      const orders: Order[] = state.day === 100 ? [hireAt(front), hireAt(front)] : [];
      const result = tick(state, [...orders, ...decideAll(state, world)], world);
      news.onDay(state, result.state, result.events, orders);
      expect(decided).toBe(i);
      expect(news.waiting).toBe(true);
      expect(news.next()).toEqual([]);
      expect(decided).toBe(i + 1);
      state = result.state;
    }
  });
});
