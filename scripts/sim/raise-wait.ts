import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { trainingDaysAt } from '../../src/sim/buildings/buildings.ts';
import type { CityId, FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { TROOPS, type Troop } from '../../src/sim/troops.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import { dateText } from '../../src/app/names.ts';
import { recruitForecast } from '../../src/ui/recruit-forecast.ts';
import { playCautiousRome } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '5' },
    troops: { type: 'string', default: 'spearmen,skirmishers,lightCavalry' },
    every: { type: 'string', default: '45' },
    world: { type: 'string', default: 'idle' },
  },
});
const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const roma = 'roma' as CityId;
const troops = values.troops.split(',') as Troop[];
const EVERY = Number(values.every);
const LAST_DAY = 12 * 365;

interface Trial {
  city: CityId;
  troop: Troop;
  named: number;
  /** The wait the card names on the named day, or null when the raise passes then. */
  againWait: number | null;
  /** The first day, checked every 5 days from the named one, the raise passes. */
  passes: number | null;
}

function forecast(state: GameState, city: CityId, troop: Troop) {
  const at = state.cities[city];
  const days = at ? trainingDaysAt(at, troop) : TROOPS[troop].recruit.days;
  return recruitForecast(state, [], world, troop, days);
}

const canAfford = (state: GameState, troop: Troop) => {
  const stores = state.factions[rome]?.stores;
  return (
    !!stores &&
    stores.gold >= TROOPS[troop].recruit.gold &&
    stores.manpower >= TROOPS[troop].recruit.men
  );
};

console.log(
  `Idle Rome raises Spearmen at Roma every ${EVERY} days while the card gives no warning. On the first day it warns, the card names a wait for each of Rome's cities and each troop; from then on Rome gives no order, and each raise is tried again on the day named, then every 5 days until it passes. ${values.world === 'ai' ? 'Every other power plays the AI.' : 'No other power gives an order.'}\n`,
);
console.log(
  '| seed | first warning | city | troop | wait named | named day | on the named day | passes | slip | wars on Rome, cities lost, Rome men lost before the named day |',
);
console.log('| ---: | --- | --- | --- | ---: | --- | --- | --- | ---: | --- |');
const slips: number[] = [];
for (
  let seed = Number(values.from);
  values.world !== 'cautious' && seed < Number(values.from) + Number(values.seeds);
  seed++
) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  let warnedOn: number | undefined;
  const trials: Trial[] = [];
  const disturbances: { day: number; war: boolean; lost: number; men: number }[] = [];
  for (let step = 0; step < LAST_DAY; step++) {
    const day = state.day;
    const orders: Order[] = values.world === 'ai' ? decideAll(state, world) : [];
    if (warnedOn === undefined && day % EVERY === 0 && canAfford(state, 'spearmen')) {
      if (forecast(state, roma, 'spearmen').warning) {
        warnedOn = day;
        for (const city of Object.values(state.cities).filter((c) => c.owner === rome))
          for (const troop of troops) {
            const wait = forecast(state, city.id, troop).holdsAfter;
            if (wait !== undefined)
              trials.push({
                city: city.id,
                troop,
                named: day + wait,
                againWait: null,
                passes: null,
              });
          }
        if (trials.length === 0) break;
      } else orders.push({ kind: 'recruit', faction: rome, city: roma, troop: 'spearmen' });
    }
    for (const trial of trials) {
      if (trial.passes !== null || day < trial.named) continue;
      if (day !== trial.named && (day - trial.named) % 5 !== 0) continue;
      if (state.cities[trial.city]?.owner !== rome) {
        trial.passes = -1;
        continue;
      }
      const f = forecast(state, trial.city, trial.troop);
      if (day === trial.named) trial.againWait = f.warning ? (f.holdsAfter ?? -1) : null;
      if (!f.warning) trial.passes = day;
    }
    const { state: next, events } = tick(state, orders, world);
    if (warnedOn !== undefined) {
      const lost = Object.values(state.cities).filter(
        (c) => c.owner === rome && next.cities[c.id]?.owner !== rome,
      ).length;
      const war = events.some((e) => e.kind === 'warDeclared' && e.against === rome);
      let men = 0;
      for (const e of events) if (e.kind === 'armyDeserted' && e.owner === rome) men += e.men;
      if (lost || war || men) disturbances.push({ day, war, lost, men });
    }
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) break;
    if (warnedOn !== undefined && trials.every((t) => t.passes !== null)) break;
  }
  if (warnedOn === undefined) {
    console.log(`| ${seed} | none in 12 years | | | | | | | | |`);
    continue;
  }
  for (const t of trials) {
    const before = disturbances.filter((d) => d.day < t.named);
    const slip = t.passes === null || t.passes < 0 ? null : t.passes - t.named;
    if (slip !== null && before.length === 0) slips.push(slip);
    console.log(
      `| ${seed} | ${dateText(warnedOn)} | ${state.cities[t.city]?.name ?? t.city} | ${t.troop} | ${t.named - warnedOn} | ${dateText(t.named)} | ${t.againWait === null ? 'no warning' : t.againWait < 0 ? 'warns, no wait' : `warns, about ${t.againWait} days`} | ${t.passes === null ? 'not in 12 years' : t.passes < 0 ? 'city lost' : dateText(t.passes)} | ${slip ?? '-'} | ${before.length ? `${before.filter((d) => d.war).length}, ${before.reduce((s, d) => s + d.lost, 0)}, ${before.reduce((s, d) => s + d.men, 0)}` : 'none'} |`,
    );
  }
}
if (values.world === 'cautious') cautious();

function cautious() {
  console.log(
    '\nThe cautious Rome of `npm run sim -- threat -- --peaceful` plays its AI, raises and builds included, and its trade. Every 45 days that Rome has the gold and men for Spearmen, so the card can be clicked, the card at Roma is read; a warning that names a wait is tried again on the day named.\n',
  );
  console.log(
    "| seed | warned | short of | Rome's orders taken until the named day | wait named | named day | on the named day | passes | slip | Rome then and on the named day: men, buildings, routes, cities |",
  );
  console.log('| ---: | --- | --- | --- | ---: | --- | --- | --- | ---: | --- |');
  for (let seed = Number(values.from); seed < Number(values.from) + Number(values.seeds); seed++) {
    let open:
      | {
          on: number;
          named: number;
          store: string;
          again: string;
          realm: ReturnType<typeof realmOf>;
          acts: Map<string, number>;
        }
      | undefined;
    let passes: number | undefined;
    const rows: string[] = [];
    playCautiousRome(
      seed,
      8,
      ({ after, accepted }) => {
        const day = after.day;
        if (open && day <= open.named)
          for (const order of accepted)
            open.acts.set(order.kind, (open.acts.get(order.kind) ?? 0) + 1);
        if (!open) {
          if (day % 45 !== 0 || !canAfford(after, 'spearmen')) return;
          const f = forecast(after, roma, 'spearmen');
          if (f.warning && f.holdsAfter !== undefined)
            open = {
              on: day,
              named: day + f.holdsAfter,
              store: (['food', 'gold'] as const).filter((k) => f.short[k] !== undefined).join(', '),
              again: '',
              realm: realmOf(after),
              acts: new Map(),
            };
          return;
        }
        if (day < open.named || (day - open.named) % 5 !== 0) return;
        const f = forecast(after, roma, 'spearmen');
        if (day === open.named) {
          const now = realmOf(after);
          open.again = `${f.warning ? (f.holdsAfter === undefined ? 'warns, no wait' : `warns, about ${f.holdsAfter} days`) : 'no warning'} | ${JSON.stringify(Object.values(open.realm))} → ${JSON.stringify(Object.values(now))}`;
        }
        if (!f.warning) passes = day;
        if (passes !== undefined || day > open.named + 3 * 365) {
          const [said, realm] = open.again.split(' | ');
          rows.push(
            `| ${seed} | ${dateText(open.on)} | ${open.store} | ${[...open.acts].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'} | ${open.named - open.on} | ${dateText(open.named)} | ${said} | ${passes === undefined ? 'not in 3 years' : dateText(passes)} | ${passes === undefined ? '-' : passes - open.named} | ${realm} |`,
          );
          open = undefined;
          passes = undefined;
        }
      },
      { peaceful: true },
    );
    for (const row of rows) console.log(row);
  }
}

const sortedSlips = [...slips].sort((a, b) => a - b);
console.log(
  `\nRaises with nothing between the warning and the named day: ${slips.length}. Slip in days: median ${sortedSlips[Math.floor(sortedSlips.length / 2)] ?? '-'}, most ${sortedSlips.at(-1) ?? '-'}; within 30 days: ${slips.filter((s) => s <= 30).length}.`,
);

/** What Rome holds that the forecast cannot foresee: men under arms and in training, buildings, running routes, the daily balance. */
function realmOf(state: GameState) {
  let men = 0;
  for (const army of Object.values(state.armies))
    if (army.owner === rome)
      for (const id of army.formations) men += state.formations[id]?.men ?? 0;
  let buildings = 0;
  for (const city of Object.values(state.cities))
    if (city.owner === rome) {
      for (const r of city.recruits) men += TROOPS[r.troop].recruit.men;
      buildings += city.buildings.length + (city.construction ? 1 : 0);
    }
  const routes = Object.values(state.tradeRoutes).filter(
    (r) => r.status === 'running' && (r.owner === rome || r.partner === rome),
  ).length;
  const cities = Object.values(state.cities).filter((c) => c.owner === rome).length;
  return { men, buildings, routes, cities };
}
