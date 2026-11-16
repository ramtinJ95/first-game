import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { standingThreats, threatNewsOfDay } from '../../src/app/threat-news.ts';
import { playCautiousRome, rome, world, type GuardPlay } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    out: { type: 'string' },
    guards: { type: 'string', default: 'never' },
  },
});

/**
 * One cautious Rome declaring no war, day by day: each great power's readiness against Rome
 * (null while at war, in a truce, or not weighing a war), the warnings the page's rule gives,
 * and each declaration on Rome with the cities Rome lost in that war. The series lets a rule
 * for the warning be weighed without playing the games again.
 */
interface Record {
  seed: number;
  days: number;
  readiness: { [power: string]: (number | null)[] };
  warnings: { day: number; power: string }[];
  wars: { day: number; power: string; citiesLost: number }[];
}

function play(seed: number, years: number): Record {
  const record: Record = { seed, days: 0, readiness: {}, warnings: [], wars: [] };
  const told = new Set<string>();
  const open = new Map<string, number>();
  playCautiousRome(
    seed,
    years,
    ({ before, after, events }) => {
      const day = before.day;
      for (const alert of threatNewsOfDay(before, after, world, told))
        record.warnings.push({ day, power: alert.text.split(' could soon')[0] ?? '' });
      const threats = new Map(standingThreats(after, world).map((t) => [t.name, t.readiness]));
      for (const power of Object.values(after.factions)) {
        if (power.kind !== 'greatPower' || power.id === rome) continue;
        const series = (record.readiness[power.name] ??= []);
        const r = threats.get(power.name);
        series[day] = r === undefined ? null : Math.round(r * 100) / 100;
      }
      for (const event of events)
        if (
          event.kind === 'warDeclared' &&
          event.against === rome &&
          after.factions[event.by]?.kind === 'greatPower'
        ) {
          open.set(event.by, record.wars.length);
          record.wars.push({
            day,
            power: after.factions[event.by]?.name ?? event.by,
            citiesLost: 0,
          });
        }
      for (const city of Object.values(before.cities)) {
        const now = after.cities[city.id];
        if (city.owner !== rome || !now || now.owner === rome) continue;
        const war = open.get(now.owner);
        const entry = war === undefined ? undefined : record.wars[war];
        if (entry) entry.citiesLost++;
      }
      record.days = after.day;
    },
    { peaceful: true, guards: values.guards as GuardPlay },
  );
  return record;
}

const rows: Record[] = [];
for (let seed = Number(values.from); seed < Number(values.from) + Number(values.seeds); seed++)
  rows.push(play(seed, Number(values.years)));
if (values.out) writeFileSync(values.out, JSON.stringify(rows));
for (const r of rows)
  console.log(
    `seed ${r.seed}: ${r.warnings.length} warnings, ${r.wars.length} wars, ${r.wars.reduce((s, w) => s + w.citiesLost, 0)} cities lost`,
  );
