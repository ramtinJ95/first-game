import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { standingThreats, threatNewsOfDay } from '../../src/app/threat-news.ts';
import { warReadiness } from '../../src/sim/ai/war.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { playCautiousRome, rome, warnedPowers, world, type GuardPlay } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    out: { type: 'string' },
    guards: { type: 'string', default: 'never' },
    answer: { type: 'boolean', default: false },
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
  wars: {
    day: number;
    power: string;
    citiesLost: number;
    /** The power's own reckoning the day it declared: its strength over what it needs, uncapped. */
    readiness: number | null;
    /** Great powers at war with Rome that day, this one included. */
    atOnce: number;
    /** The day the war ended, or null if it outlasted the game. */
    endedOn: number | null;
  }[];
}

function play(seed: number, years: number): Record {
  const record: Record = { seed, days: 0, readiness: {}, warnings: [], wars: [] };
  const told = new Set<string>();
  const open = new Map<FactionId, number>();
  playCautiousRome(
    seed,
    years,
    ({ before, after, events }) => {
      const day = before.day;
      for (const alert of threatNewsOfDay(before, after, world, told))
        for (const power of warnedPowers(alert.text)) record.warnings.push({ day, power });
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
          const reckoned = warReadiness(before, world, event.by, rome);
          record.wars.push({
            day,
            power: after.factions[event.by]?.name ?? event.by,
            citiesLost: 0,
            readiness: reckoned ? Math.round(reckoned.readiness * 100) / 100 : null,
            atOnce: Object.values(after.factions).filter(
              (f) => f.kind === 'greatPower' && f.id !== rome && areAtWar(after, f.id, rome),
            ).length,
            endedOn: null,
          });
        }
      for (const city of Object.values(before.cities)) {
        const now = after.cities[city.id];
        if (city.owner !== rome || !now || now.owner === rome) continue;
        const war = open.get(now.owner);
        const entry = war === undefined ? undefined : record.wars[war];
        if (entry) entry.citiesLost++;
      }
      for (const [power, index] of open) {
        const entry = record.wars[index];
        if (entry && entry.endedOn === null && !areAtWar(after, power, rome)) {
          entry.endedOn = day;
          open.delete(power);
        }
      }
      record.days = after.day;
    },
    { peaceful: true, guards: values.guards as GuardPlay, answer: values.answer },
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
