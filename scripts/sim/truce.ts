import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { peaceWish } from '../../src/sim/ai/peace.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import { standingOffer } from '../../src/sim/peace/offer.ts';
import { copyTerms, termsPoints, termsProblem } from '../../src/sim/peace/terms.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { warKey, warSides } from '../../src/sim/state/war.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

/**
 * Asks whether buying peace pays for an idle Rome. Rome gives no orders of its own. Under
 * "pays" it accepts every offer of peace made to it that it can meet; under "refuses" it
 * refuses every one. Prints, for each paid peace, the days until the same power declares
 * war on Rome again, and the day Rome falls under each policy.
 */

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '10' },
  },
});
const FROM = Number(values.from);
const SEEDS = Number(values.seeds);
const DAYS = Number(values.years) * 365;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
type Policy = 'pays' | 'refuses';

interface PaidPeace {
  enemy: FactionId;
  day: number;
  gold: number;
  cities: number;
  points: number;
  truceDays: number;
  /** Days to the same power's next declaration on Rome, undefined when none came. */
  again: number | undefined;
}

interface Run {
  fell: number | undefined;
  paid: PaidPeace[];
  /** Each offer to Rome: the points it asks and the least the sender would take. */
  asks: { asked: number; least: number }[];
}

function romeAnswers(state: GameState, policy: Policy): Order[] {
  const orders: Order[] = [];
  for (const key of Object.keys(state.wars).sort()) {
    const sides = warSides(key);
    if (!sides?.includes(rome)) continue;
    const enemy = sides[0] === rome ? sides[1] : sides[0];
    const offer = standingOffer(state, rome, enemy);
    if (!offer || offer.from !== enemy) continue;
    orders.push(
      policy === 'pays' && !termsProblem(state, [rome, enemy], offer.terms)
        ? { kind: 'acceptPeace', faction: rome, from: enemy, terms: copyTerms(offer.terms) }
        : { kind: 'refusePeace', faction: rome, from: enemy },
    );
  }
  return orders;
}

function play(seed: number, policy: Policy): Run {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const paid: PaidPeace[] = [];
  const asks: Run['asks'] = [];
  const waiting = new Map<FactionId, PaidPeace>();
  for (let day = 0; day < DAYS && state.factions[rome]?.defeatedOn === null; day += 1) {
    const before = state;
    const result = tick(
      state,
      [...romeAnswers(state, policy), ...decideAll(state, world, [rome])],
      world,
    );
    for (const event of result.events) {
      if (event.kind !== 'peaceMade' || !event.between.includes(rome)) continue;
      const { terms } = event;
      if (terms.kind !== 'payment' || terms.payer !== rome) continue;
      const enemy = event.between[0] === rome ? event.between[1] : event.between[0];
      const truce = result.state.truces[warKey(rome, enemy)];
      const record: PaidPeace = {
        enemy,
        day: result.state.day,
        gold: terms.gold,
        cities: terms.cities.length,
        points: termsPoints(before, terms, enemy),
        truceDays: truce ? truce.endsOn - truce.since : 0,
        again: undefined,
      };
      paid.push(record);
      waiting.set(enemy, record);
    }
    for (const [key, offer] of Object.entries(result.state.peaceOffers)) {
      const enemy = offer.from;
      if (enemy === rome || !warSides(key)?.includes(rome)) continue;
      if (before.peaceOffers[key as keyof GameState['peaceOffers']]?.madeOn === offer.madeOn)
        continue;
      // The AI chose the price on the day's facts before the tick, so its floor is read there.
      const wish = peaceWish(before, enemy, rome);
      if (wish) asks.push({ asked: termsPoints(before, offer.terms, enemy), least: -wish.wish });
    }
    for (const [enemy, record] of [...waiting]) {
      if (!Object.hasOwn(result.state.wars, warKey(rome, enemy))) continue;
      if (result.state.wars[warKey(rome, enemy)]?.declaredBy !== enemy) continue;
      record.again = result.state.day - record.day;
      waiting.delete(enemy);
    }
    state = result.state;
  }
  const fell = state.factions[rome]?.defeatedOn ?? undefined;
  return { fell: fell ?? undefined, paid, asks };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? undefined : sorted[Math.floor(sorted.length / 2)];
};
const show = (value: number | undefined, none: string) =>
  value === undefined || !Number.isFinite(value) ? none : value.toLocaleString('en');

const started = performance.now();
const runs: Record<Policy, Run[]> = { pays: [], refuses: [] };
for (let seed = FROM; seed < FROM + SEEDS; seed += 1) {
  for (const policy of ['pays', 'refuses'] as const) runs[policy].push(play(seed, policy));
  const pays = runs.pays.at(-1) as Run;
  const refuses = runs.refuses.at(-1) as Run;
  console.log(
    `seed ${String(seed).padStart(2)}: Rome falls ${show(pays.fell, 'never')} paying (${pays.paid.length} paid peaces: ${pays.paid.map((p) => `${p.enemy} ${p.gold}g${p.cities ? `+${p.cities}c` : ''} day ${p.day}, truce ${p.truceDays}, again ${show(p.again, '-')}`).join('; ')}), ${show(refuses.fell, 'never')} refusing`,
  );
}

const paid = runs.pays.flatMap((run) => run.paid);
const again = paid.flatMap((peace) => (peace.again === undefined ? [] : [peace.again]));
const fallOf = (run: Run) => run.fell ?? Number.POSITIVE_INFINITY;
const longer = runs.pays.filter((run, i) => fallOf(run) > fallOf(runs.refuses[i] as Run)).length;
const shorter = runs.pays.filter((run, i) => fallOf(run) < fallOf(runs.refuses[i] as Run)).length;
const gained = runs.pays.map((run, i) => {
  const a = Math.min(fallOf(run), DAYS);
  const b = Math.min(fallOf(runs.refuses[i] as Run), DAYS);
  return a - b;
});

console.log(`\nSeeds ${FROM} to ${FROM + SEEDS - 1}, ${DAYS / 365} years, Rome gives no orders.\n`);
console.log('| Measure | Value |');
console.log('| --- | --- |');
console.log(
  `| Paid peaces | ${paid.length} in ${runs.pays.filter((r) => r.paid.length).length} seeds |`,
);
console.log(`| Median gold paid | ${show(median(paid.map((p) => p.gold)), '-')} |`);
console.log(
  `| Median truce after a paid peace | ${show(median(paid.map((p) => p.truceDays)), '-')} days |`,
);
console.log(
  `| Same power declares again | ${again.length} of ${paid.length}, shortest ${show(again.length ? Math.min(...again) : undefined, '-')}, median ${show(median(again), '-')} days |`,
);
console.log(
  `| Median days to re-declaration, none counted as never | ${show(median(paid.map((p) => p.again ?? Number.POSITIVE_INFINITY)), 'never')} |`,
);
console.log(
  `| Median day Rome falls, pays / refuses | ${show(median(runs.pays.map(fallOf)), 'survives')} / ${show(median(runs.refuses.map(fallOf)), 'survives')} |`,
);
console.log(
  `| Rome survives ${DAYS / 365} years, pays / refuses | ${runs.pays.filter((r) => r.fell === undefined).length} / ${runs.refuses.filter((r) => r.fell === undefined).length} of ${SEEDS} |`,
);
console.log(`| Seeds where paying lives longer / shorter | ${longer} / ${shorter} |`);
console.log(
  `| Median days gained by paying, capped at the horizon | ${show(median(gained), '-')} |`,
);
const asks = [...runs.pays, ...runs.refuses]
  .flatMap((run) => run.asks)
  .filter((ask) => ask.asked > 0);
const over = asks.map((ask) => ask.asked - Math.max(0, ask.least)).sort((a, b) => a - b);
console.log(
  `| Priced offers to Rome, both policies: median asked / least the sender takes, points | ${asks.length}: ${show(median(asks.map((a) => a.asked)), '-')} / ${show(median(asks.map((a) => Math.max(0, a.least))), '-')} |`,
);
console.log(
  `| Ask above that least, points: median / 90th percentile / most | ${show(median(over), '-')} / ${show(over[Math.floor(over.length * 0.9)], '-')} / ${show(over.at(-1), '-')} |`,
);
console.log(
  `| Offers asking over 5 points (500 gold) above that least | ${over.filter((points) => points > 5).length} of ${over.length} |`,
);
console.log(`\n${((performance.now() - started) / 1000).toFixed(0)} s`);
