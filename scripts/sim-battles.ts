import { playTrial, type Matchup, type TrialResult } from '../src/sim/battle-trial.ts';

const MIX: Matchup['a']['troops'] = {
  spearmen: 1500,
  swordsmen: 900,
  archers: 300,
  lightCavalry: 300,
};
const double = (troops: Matchup['a']['troops']) =>
  Object.fromEntries(Object.entries(troops).map(([troop, men]) => [troop, men * 2]));

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
];

const SEEDS = 500;

const mean = (values: number[]) =>
  values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;
const percent = (share: number) => (Number.isNaN(share) ? '-' : `${Math.round(share * 100)}%`);

function summarise(matchup: Matchup) {
  const results: TrialResult[] = Array.from({ length: SEEDS }, (_, seed) =>
    playTrial(matchup, seed + 1),
  );
  const decided = results.filter((r) => r.winner !== 'none');
  const winnerKept = decided.map((r) => r.kept[r.winner === 'a' ? 'a' : 'b']);
  const loserKept = decided.map((r) => r.kept[r.winner === 'a' ? 'b' : 'a']);
  return {
    matchup: matchup.name,
    'a wins': percent(results.filter((r) => r.winner === 'a').length / SEEDS),
    days: mean(results.map((r) => r.days)).toFixed(1),
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

const logAt = process.argv.indexOf('--log');
if (logAt >= 0) {
  printLog(Number(process.argv[logAt + 1] ?? 0), Number(process.argv[logAt + 2] ?? 1));
} else {
  console.log(`${SEEDS} seeds per matchup. Keeps are shares of the men a side started with.`);
  console.table(MATCHUPS.map(summarise));
}
