import {
  buildTrial,
  playTrial,
  TRIAL_ARMIES,
  type Matchup,
  type TrialResult,
} from '../src/sim/battle-trial.ts';
import { fixtureWorld } from '../src/sim/fixture.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import { STANCES, type Stance } from '../src/sim/state/army.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { tick } from '../src/sim/tick.ts';

const MIX: Matchup['a']['troops'] = {
  spearmen: 1500,
  swordsmen: 900,
  archers: 300,
  lightCavalry: 300,
};
const scaled = (troops: Matchup['a']['troops'], by: number) =>
  Object.fromEntries(Object.entries(troops).map(([troop, men]) => [troop, Math.round(men * by)]));
const double = (troops: Matchup['a']['troops']) => scaled(troops, 2);
const FOOT: Matchup['a']['troops'] = { spearmen: 1800, swordsmen: 1200 };
const MOUNTED: Matchup['a']['troops'] = { archers: 1200, lightCavalry: 1000, heavyCavalry: 800 };

/** Edit this list to tune. Army a is the first side of each row. */
const MATCHUPS: Matchup[] = [
  {
    name: 'equal mix, 3000 v 3000',
    a: { troops: MIX },
    b: { troops: MIX },
  },
  {
    name: 'double mix, 6000 v 3000',
    a: { troops: double(MIX) },
    b: { troops: MIX },
  },
  {
    name: 'mix, 4500 v 3000',
    a: {
      troops: Object.fromEntries(Object.entries(MIX).map(([troop, men]) => [troop, men * 1.5])),
    },
    b: { troops: MIX },
  },
  {
    name: 'spearmen v heavy cavalry, 3000 each',
    a: { troops: { spearmen: 3000 } },
    b: { troops: { heavyCavalry: 3000 } },
  },
  {
    name: 'heavy cavalry v swordsmen, 3000 each',
    a: { troops: { heavyCavalry: 3000 } },
    b: { troops: { swordsmen: 3000 } },
  },
  {
    name: 'light cavalry v archers, 3000 each',
    a: { troops: { lightCavalry: 3000 } },
    b: { troops: { archers: 3000 } },
  },
  {
    name: 'equal mix, assault v hold',
    a: {
      troops: MIX,
      stance: 'allOutAssault',
    },
    b: { troops: MIX },
  },
  {
    name: 'equal mix, both assault',
    a: {
      troops: MIX,
      stance: 'allOutAssault',
    },
    b: {
      troops: MIX,
      stance: 'allOutAssault',
    },
  },
  {
    name: 'equal mix, skirmish v hold',
    a: {
      troops: MIX,
      stance: 'skirmishAndWithdraw',
    },
    b: { troops: MIX },
  },
  {
    name: 'equal mix, both skirmish',
    a: { troops: MIX, stance: 'skirmishAndWithdraw' },
    b: { troops: MIX, stance: 'skirmishAndWithdraw' },
  },
  {
    name: 'equal mix, general 8 v 0',
    a: {
      troops: MIX,
      generalSkill: 8,
    },
    b: {
      troops: MIX,
      generalSkill: 0,
    },
  },
  {
    name: 'general 10 v 0, 3000 v 3600',
    a: { troops: MIX, generalSkill: 10 },
    b: {
      troops: { spearmen: 1800, swordsmen: 1080, archers: 360, lightCavalry: 360 },
      generalSkill: 0,
    },
  },
  {
    name: 'remnant, 3000 v 40 spearmen',
    a: { troops: MIX },
    b: { troops: { spearmen: 40 } },
  },
  {
    name: 'small, 3000 v 400 spearmen',
    a: { troops: MIX },
    b: { troops: { spearmen: 400 } },
  },
];

const SEEDS = 500;

const mean = (values: number[]) =>
  values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
};
const percent = (share: number) => (Number.isNaN(share) ? '-' : `${Math.round(share * 100)}%`);

function summarise(matchup: Matchup) {
  const results: TrialResult[] = Array.from({ length: SEEDS }, (_, seed) =>
    playTrial(matchup, seed + 1),
  );
  const days = results.map((r) => r.days);
  const decided = results.filter((r) => r.winner !== 'none');
  const winnerKept = decided.map((r) => r.kept[r.winner === 'a' ? 'a' : 'b']);
  const loserKept = decided.map((r) => r.kept[r.winner === 'a' ? 'b' : 'a']);
  return {
    matchup: matchup.name,
    'a wins': percent(results.filter((r) => r.winner === 'a').length / SEEDS),
    'days p10/median/p90': [0.1, 0.5, 0.9].map((q) => quantile(days, q)).join(' / '),
    'b destroyed on day 1': percent(
      results.filter((r) => r.days === 1 && r.kept.b === 0).length / SEEDS,
    ),
    'a keeps': percent(mean(results.map((r) => r.kept.a))),
    'b keeps': percent(mean(results.map((r) => r.kept.b))),
    'winner keeps': percent(mean(winnerKept)),
    'loser keeps': percent(mean(loserKept)),
    'loser keeps, worst': percent(Math.min(...loserKept)),
  };
}

function printLog(index: number, seed: number) {
  const matchup = MATCHUPS[index];
  if (!matchup) throw new Error(`There is no matchup ${index}.`);
  const result = playTrial(matchup, seed);
  console.log(`${matchup.name}, seed ${seed}: ${result.winner} wins after ${result.days} days`);
  result.log.forEach((formations, day) => {
    const cells = formations.map((f) => `${f.army}.${f.troop} ${f.men} ${f.morale.toFixed(2)}`);
    console.log(`day ${String(day + 1).padStart(2)}  ${cells.join('  ')}`);
  });
}

/**
 * Rome's 3,000 lose beside Roma and fall back to a city of Rome's. Carthage's army marches
 * after them each day they stand still, as a winner that means to finish them does.
 */
const CHASES: Matchup[] = [
  { name: 'chased by an equal mix, 3000 v 3000', a: { troops: MIX }, b: { troops: MIX } },
  {
    name: 'chased by a larger mix, 3000 v 4500',
    a: { troops: MIX },
    b: {
      troops: Object.fromEntries(Object.entries(MIX).map(([troop, men]) => [troop, men * 1.5])),
    },
  },
];
const CHASE_SEEDS = 200;
const CHASE_DAYS = 30;

interface Chase {
  /** The beaten army reached the city it fell back to. */
  reached: boolean;
  /** It was alive CHASE_DAYS after its first battle ended. */
  alive: boolean;
  /** The days of its first battle at its refuge, and whether it held the field, if it fought one. */
  refuge?: { days: number; held: boolean };
}

function playChase(matchup: Matchup, seed: number): Chase | undefined {
  const world = fixtureWorld();
  const { a, b } = TRIAL_ARMIES;
  let state: GameState = buildTrial(matchup, seed);
  do state = tick(state, [], world).state;
  while (Object.keys(state.battles).length > 0 && state.day < 60);
  const retreat = state.armies[a]?.activity;
  const to = retreat?.kind === 'retreating' ? retreat.waypoints.at(-1) : undefined;
  if (!to) return undefined;
  let reached = false;
  let refuge: Chase['refuge'];
  for (let day = 0; day < CHASE_DAYS; day++) {
    const loser = state.armies[a];
    const winner = state.armies[b];
    if (!loser || loser.activity.kind === 'embarked') break;
    const at = loser.activity.position;
    if (loser.activity.kind === 'idle' && Math.hypot(at.x - to.x, at.y - to.y) < 1) reached = true;
    const end = winner?.activity.kind === 'marching' ? winner.activity.waypoints.at(-1) : undefined;
    const follows =
      winner &&
      loser.activity.kind === 'idle' &&
      winner.activity.kind !== 'inBattle' &&
      winner.activity.kind !== 'retreating' &&
      !(end?.x === at.x && end.y === at.y);
    const orders: Order[] = follows
      ? [{ kind: 'moveArmy', faction: winner.owner, army: b, to: at }]
      : [];
    const { state: next, events } = tick(state, orders, world);
    for (const event of events) {
      if (event.kind !== 'battleEnded' || !reached || refuge) continue;
      const side = event.attackers.factions.includes(loser.owner) ? 'attackers' : 'defenders';
      refuge = { days: event.days, held: event.winner === side };
    }
    state = next;
  }
  return { reached, alive: Object.hasOwn(state.armies, a), ...(refuge && { refuge }) };
}

function summariseChase(matchup: Matchup) {
  const chases = Array.from({ length: CHASE_SEEDS }, (_, seed) => playChase(matchup, seed + 1));
  const beaten = chases.flatMap((c) => (c ? [c] : []));
  const fought = beaten.flatMap((c) => (c.reached && c.refuge ? [c.refuge] : []));
  return {
    chase: matchup.name,
    'Rome beaten': percent(beaten.length / CHASE_SEEDS),
    'reached its refuge': percent(beaten.filter((c) => c.reached).length / beaten.length),
    [`alive ${CHASE_DAYS} days on`]: percent(beaten.filter((c) => c.alive).length / beaten.length),
    'fought there': percent(fought.length / beaten.length),
    'broken there on day 1': percent(
      fought.filter((r) => r.days === 1 && !r.held).length / fought.length,
    ),
    'days there p10/median/p90': [0.1, 0.5, 0.9]
      .map((q) =>
        quantile(
          fought.map((r) => r.days),
          q,
        ),
      )
      .join(' / '),
    'held the field there': percent(fought.filter((r) => r.held).length / fought.length),
  };
}

function printChases() {
  console.log(
    `\n${CHASE_SEEDS} seeds per chase. Rome's beaten army falls back to its own city and the winner follows it.`,
  );
  console.table(CHASES.map(summariseChase));
}

const STANCE_SEEDS = 200;
const STANCE_NAMES: Record<Stance, string> = {
  holdTheLine: 'hold',
  allOutAssault: 'assault',
  skirmishAndWithdraw: 'skirmish',
};

/**
 * Plays every stance of army a against every stance of army b and prints how often a
 * wins, with the median days fought, one row for each of a's stances.
 */
function printStances(title: string, a: Matchup['a']['troops'], b: Matchup['b']['troops']) {
  const rows = STANCES.map((mine) => {
    const row: Record<string, string> = { [`a ${title}`]: STANCE_NAMES[mine] };
    for (const theirs of STANCES) {
      const results = Array.from({ length: STANCE_SEEDS }, (_, seed) =>
        playTrial(
          { name: '', a: { troops: a, stance: mine }, b: { troops: b, stance: theirs } },
          seed + 1,
        ),
      );
      const wins = results.filter((r) => r.winner === 'a').length / STANCE_SEEDS;
      row[`v ${STANCE_NAMES[theirs]}`] = `${percent(wins)}, ${quantile(
        results.map((r) => r.days),
        0.5,
      )} days`;
    }
    return row;
  });
  console.table(rows);
}

function printStanceTables() {
  console.log(
    `\n${STANCE_SEEDS} seeds per cell. Each cell is how often army a wins, and the median days fought.`,
  );
  printStances('3000 mix v 3000 mix', MIX, MIX);
  printStances('3000 mix v 3900 mix', MIX, scaled(MIX, 1.3));
  printStances('3000 foot v 3000 horse and bows', FOOT, MOUNTED);
}

const logAt = process.argv.indexOf('--log');
if (logAt >= 0) {
  printLog(Number(process.argv[logAt + 1] ?? 0), Number(process.argv[logAt + 2] ?? 1));
} else if (process.argv.includes('--chase')) {
  printChases();
} else if (process.argv.includes('--stances')) {
  printStanceTables();
} else {
  console.log(`${SEEDS} seeds per matchup. Keeps are shares of the men a side started with.`);
  console.table(MATCHUPS.map(summarise));
  printStanceTables();
  printChases();
}
