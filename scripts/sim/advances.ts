import { parseArgs } from 'node:util';
import type { FactionId } from '../../src/sim/ids.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import { ADVANCE_KINDS } from '../../src/sim/advances/advances.ts';
import { studyRefusal } from '../../src/sim/advances/study.ts';
import { bestStudy } from '../../src/sim/ai/study.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf } from '../../src/sim/systems/economy.ts';
import { playCautiousRome, rome } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    players: { type: 'string', default: 'ruler,answering,stranger' },
  },
});

/**
 * Romes at peace: the AI plays Rome, its trade included, and it declares no war. `ruler`
 * does nothing about a warning (the slide's `ignoring`), and `answering` answers each
 * warning as it advises. `stranger` answers too but never builds, a player who has not
 * found the buildings list, and studies the advance the panel suggests whenever nothing is
 * studied. Every other
 * power plays the AI.
 */
const PLAYERS = ['ruler', 'answering', 'stranger'] as const;
/** The orders a stranger takes from no rule of the AI: it never builds, and studies as the panel suggests. */
const STRANGER_SKIPS = new Set<Order['kind']>(['build', 'study']);
type Player = (typeof PLAYERS)[number];

interface Year {
  /** Days that end with Rome's gold at its limit. */
  atLimit: number;
  /** Gold a day's income would have added on a day at the limit, which the limit throws away. */
  lost: number;
  /** Rome's income less upkeep, summed over the days, trade at its expected rate. */
  net: number;
  /** The treasury at the end of the year less at its start. */
  rise: number;
  limit: number;
  /** Days with an advance at work, and days with none at work but one Rome could start. */
  studying: number;
  choosing: number;
  /** Advances Rome had studied by the end of the year. */
  studied: number;
}

const emptyYear = (): Year => ({
  atLimit: 0,
  lost: 0,
  net: 0,
  rise: 0,
  limit: 0,
  studying: 0,
  choosing: 0,
  studied: 0,
});

function count(years: Year[], before: GameState, after: GameState) {
  const year = years[Math.floor((before.day - 1) / 365)];
  if (!year) return;
  const gold = (s: GameState) => s.factions[rome]?.stores.gold ?? 0;
  const cap = limitsOf(before).get(rome as FactionId)?.gold ?? Infinity;
  const net = dailyBalances(before).get(rome as FactionId)?.gold ?? 0;
  year.net += net;
  year.rise += gold(after) - gold(before);
  year.limit = limitsOf(after).get(rome as FactionId)?.gold ?? 0;
  if (gold(after) >= cap - 1) {
    year.atLimit++;
    year.lost += Math.max(0, net - (gold(after) - gold(before)));
  }
  const realm = after.factions[rome];
  if (realm?.study) year.studying++;
  else if (ADVANCE_KINDS.some((kind) => !studyRefusal(after, rome, kind))) year.choosing++;
  year.studied = realm?.advances.length ?? 0;
}

/** The panel's suggestion, as a stranger who opens the panel takes it, on a day nothing is studied. */
function asThePanelSuggests(state: GameState): Order[] {
  const realm = state.factions[rome];
  if (!realm || realm.study) return [];
  const best = bestStudy(state, rome, realm.stores.gold);
  return best ? [{ kind: 'study', faction: rome, advance: best.advance }] : [];
}

function play(player: Player, seed: number, years: number): Year[] {
  const counted = Array.from({ length: years }, emptyYear);
  playCautiousRome(seed, years, ({ before, after }) => count(counted, before, after), {
    peaceful: true,
    answer: player !== 'ruler',
    orders: (orders, state) =>
      player === 'stranger'
        ? [
            ...orders.filter((o) => o.faction !== rome || !STRANGER_SKIPS.has(o.kind)),
            ...asThePanelSuggests(state),
          ]
        : orders,
  });
  return counted;
}

const median = (all: readonly number[]) => {
  const sorted = [...all].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const whole = (n: number) => Math.round(n).toLocaleString('en-GB');

const players = values.players.split(',') as Player[];
const first = Number(values.from);
const seeds = Number(values.seeds);
const years = Number(values.years);
console.log(
  `Rome at peace, seeds ${first} to ${first + seeds - 1}, medians over seeds. "Spare" is the gold the limit threw away plus the rise in the treasury: what Rome could have spent that year without giving up anything it did. "Lost" is estimated as the day's balance, trade at its expected rate, less what the treasury gained on a day that ends at the limit.`,
);
for (const player of players) {
  if (!PLAYERS.includes(player)) throw new Error(`--players takes ${PLAYERS.join(', ')}`);
  const games = Array.from({ length: seeds }, (_, i) => play(player, first + i, years));
  console.log(`\n### ${player}\n`);
  console.log(
    '| year | days at the limit | gold lost to the limit | treasury rise | spare | net income | limit | days studying | days with one to choose | advances studied |',
  );
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  let spareSum = 0;
  let atLimitSum = 0;
  for (let y = 0; y < years; y++) {
    const of = (f: (r: Year) => number) => median(games.map((g) => f(g[y] ?? emptyYear())));
    const spare = of((r) => r.lost + r.rise);
    spareSum += spare;
    atLimitSum += of((r) => r.atLimit);
    console.log(
      `| ${y + 1} | ${of((r) => r.atLimit)} | ${whole(of((r) => r.lost))} | ${whole(of((r) => r.rise))} | ${whole(spare)} | ${whole(of((r) => r.net))} | ${whole(of((r) => r.limit))} | ${of((r) => r.studying)} | ${of((r) => r.choosing)} | ${of((r) => r.studied)} |`,
    );
  }
  const busyYears = games.map(
    (g) => g.slice(1).filter((r) => r.studying > 0 || r.choosing > 0).length,
  );
  console.log(
    `\nSummary: | ${player} | days at the limit, years 1–${years}, sum of yearly medians ${atLimitSum} | spare gold ${whole(spareSum)} | seeds with an advance at work or one to choose in every year from 2: ${busyYears.filter((n) => n === years - 1).length} of ${seeds} |`,
  );
}
