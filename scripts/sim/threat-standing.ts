import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { standingThreats, threatNewsOfDay } from '../../src/app/threat-news.ts';
import { truceBetween } from '../../src/sim/peace/truce.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { playCautiousRome, rome, world } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
  },
});

interface Row {
  seed: number;
  /** Milliseconds of each day's standingThreats after the day's news has reckoned each power, as the top bar and the wars panel pay it. */
  costs: number[];
  warnings: number;
  /** Peace stretches in which a power reached the full strength it needs: one more line each under a once-in-a-peace rule. */
  fullLines: number;
  /** For each declaration on Rome by a great power, the days since that power first reached full strength in that peace, or null. */
  declarations: (number | null)[];
}

const quantile = (all: readonly number[], q: number) => {
  const sorted = [...all].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};

function play(seed: number, years: number): Row {
  const row: Row = { seed, costs: [], warnings: 0, fullLines: 0, declarations: [] };
  const told = new Set<string>();
  const fullOn = new Map<string, number>();
  playCautiousRome(
    seed,
    years,
    ({ before, after, events }) => {
      row.warnings += threatNewsOfDay(before, after, world, told).filter(
        (alert) => alert.kind === 'warThreat',
      ).length;
      const start = performance.now();
      const threats = standingThreats(after, world);
      row.costs.push(performance.now() - start);
      for (const event of events)
        if (
          event.kind === 'warDeclared' &&
          event.against === rome &&
          after.factions[event.by]?.kind === 'greatPower'
        ) {
          const full = fullOn.get(event.by);
          row.declarations.push(full === undefined ? null : before.day - full);
        }
      for (const power of Object.values(after.factions))
        if (areAtWar(after, power.id, rome) || truceBetween(after, power.id, rome))
          fullOn.delete(power.id);
      for (const threat of threats)
        if ((threat.readiness ?? 0) >= 1 && !fullOn.has(threat.power)) {
          fullOn.set(threat.power, before.day);
          row.fullLines++;
        }
    },
    { peaceful: true },
  );
  return row;
}

const rows: Row[] = [];
for (let seed = Number(values.from); seed < Number(values.from) + Number(values.seeds); seed++) {
  const row = play(seed, Number(values.years));
  rows.push(row);
  if (values.json)
    console.log(
      JSON.stringify({
        ...row,
        costs: undefined,
        median: quantile(row.costs, 0.5),
        p95: quantile(row.costs, 0.95),
        max: quantile(row.costs, 1),
      }),
    );
}
const costs = rows.flatMap((r) => r.costs);
const declarations = rows.flatMap((r) => r.declarations);
const reached = declarations.filter((d): d is number => d !== null);
console.log(
  `Cautious Rome declaring no war, seeds ${values.from} to ${Number(values.from) + Number(values.seeds) - 1}, ${values.years} years.`,
);
console.log(
  `standingThreats after the day's news, every great power at peace with Rome, ${costs.length} days: median ${quantile(costs, 0.5).toFixed(2)} ms, p95 ${quantile(costs, 0.95).toFixed(2)} ms, most ${quantile(costs, 1).toFixed(2)} ms.`,
);
console.log(
  `News lines a game: ${rows.reduce((s, r) => s + r.warnings, 0) / rows.length} warnings today; a line at full strength once in a peace would add ${rows.reduce((s, r) => s + r.fullLines, 0) / rows.length}.`,
);
console.log(
  `Declarations on Rome: ${declarations.length}; ${reached.length} came after the power reached full strength in that peace, median ${quantile(reached, 0.5)} days after, 9 in 10 within ${quantile(reached, 0.9)}; ${reached.filter((d) => d <= 1).length} within a day.`,
);
