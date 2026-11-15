import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { mostNeeded } from '../../src/sim/ai/budget.ts';
import { trainingDaysAt } from '../../src/sim/buildings/buildings.ts';
import type { CityId, FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { beleaguered } from '../../src/sim/systems/sieges.ts';
import { tick } from '../../src/sim/tick.ts';
import { TROOPS } from '../../src/sim/troops.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import { afterWaiting } from '../../src/ui/buildings-text.ts';
import { recruitForecast } from '../../src/ui/recruit-forecast.ts';

const RULES = {
  none: () => false,
  'any distance, today’s yields': (f: Forecast) =>
    f.lasts.food !== undefined || f.lasts.gold !== undefined,
  'within 365 days, today’s yields': (f: Forecast) =>
    (f.lasts.food ?? Infinity) <= 365 || (f.lasts.gold ?? Infinity) <= 365,
  'any distance, growing people': (f: Forecast) => f.warning !== undefined,
} as const;
type Forecast = ReturnType<typeof recruitForecast>;
type Rule = keyof typeof RULES;

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '10' },
    rule: { type: 'string' },
    sort: { type: 'boolean', default: false },
    audit: { type: 'boolean', default: false },
  },
});
const seeds = Number(values.seeds);
const years = Number(values.years);
const rules = (values.rule ? [values.rule] : Object.keys(RULES)) as Rule[];
for (const rule of rules) if (!Object.hasOwn(RULES, rule)) throw new Error(`no rule ${rule}`);
const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;

console.log(
  `Cautious Rome, ${years} years, seeds 1 to ${seeds}. Every faction plays the AI, Rome included, except Rome's recruits:`,
);
console.log(
  "each day Rome raises the AI's most needed troop at Roma, or else its first city that can train it, whenever it has the gold and men, unless the recruit card warns. Rome heeds every warning.",
);
console.log('Hunger counts men who deserted while food was short; unpaid, while only gold was.\n');
console.log(
  '| warning rule | regiments raised | men lost to hunger | men lost unpaid | cities lost | seeds Rome defeated | warned days |',
);
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
const BANDS = [365, 730, 1460, Infinity] as const;
let chosen: Forecast | undefined;
const audited: { day: number; forecast: Forecast; shortOn: number | undefined; seed?: number }[] =
  [];
const sorted = new Map<string, { growthWarns: number; growthClears: number }>(
  (['food', 'gold'] as const).flatMap((store) =>
    BANDS.map((band) => [bandKey(store, band), { growthWarns: 0, growthClears: 0 }]),
  ),
);
for (const rule of rules) {
  const total = { raised: 0, hunger: 0, unpaid: 0, lost: 0, defeated: 0, warned: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const row = play(seed, RULES[rule]);
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += row[key];
    if (values.rule) console.error(JSON.stringify({ rule, seed, ...row }));
  }
  console.log(
    `| ${rule} | ${total.raised} | ${total.hunger} | ${total.unpaid} | ${total.lost} | ${total.defeated} | ${total.warned} |`,
  );
}

function play(seed: number, warns: (forecast: Forecast) => boolean) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const row = { raised: 0, hunger: 0, unpaid: 0, lost: 0, defeated: 0, warned: 0 };
  for (let day = 0; day < years * 365; day++) {
    const orders: Order[] = decideAll(state, world, []).filter(
      (order) => !(order.kind === 'recruit' && order.faction === rome),
    );
    const raise = cautiousRaise(state, orders, warns);
    if (raise === 'warned') row.warned++;
    else if (raise) orders.push(raise);
    const owned = citiesOf(state);
    const { state: next, events, rejected } = tick(state, orders, world);
    if (raise && raise !== 'warned' && !rejected.some((r) => r.order === raise)) {
      row.raised++;
      if (values.audit && chosen) audited.push({ day, forecast: chosen, shortOn: undefined });
    }
    const stores = next.factions[rome]?.stores;
    if (stores && (stores.food < 0 || stores.gold < 0))
      for (const entry of audited)
        if (entry.shortOn === undefined && entry.seed === undefined) entry.shortOn = day;
    for (const event of events) {
      if (event.kind !== 'armyDeserted' || event.owner !== rome || !stores) continue;
      if (stores.food < 0) row.hunger += event.men;
      else row.unpaid += event.men;
    }
    const still = citiesOf(next);
    row.lost += [...owned].filter((id) => !still.has(id)).length;
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) {
      row.defeated = 1;
      break;
    }
  }
  for (const entry of audited) entry.seed ??= seed;
  return row;
}

/** Rome's other orders of the day apply first, as the panel counts orders already given. */
function cautiousRaise(
  today: GameState,
  others: readonly Order[],
  warns: (forecast: Forecast) => boolean,
): Order | 'warned' | undefined {
  const troop = mostNeeded(today, rome);
  const { gold, men, days } = TROOPS[troop].recruit;
  const before = today.factions[rome]?.stores;
  if (!before || before.gold < gold || before.manpower < men) return undefined;
  const state = afterWaiting(today, others, world);
  const stores = state.factions[rome]?.stores;
  if (!stores || stores.gold < gold || stores.manpower < men) return undefined;
  const city = Object.values(state.cities)
    .filter((c) => c.owner === rome && c.unrestDays === 0 && !beleaguered(state, c))
    .sort((a, b) => Number(b.id === 'roma') - Number(a.id === 'roma') || (a.id < b.id ? -1 : 1))[0];
  if (!city) return undefined;
  const forecast = recruitForecast(state, [], world, troop, trainingDaysAt(city, days));
  if (values.sort) sortForecast(forecast);
  chosen = forecast;
  if (warns(forecast)) return 'warned';
  return { kind: 'recruit', faction: rome, city: city.id as CityId, troop };
}

function citiesOf(state: GameState): Set<string> {
  return new Set(
    Object.values(state.cities)
      .filter((c) => c.owner === rome)
      .map((c) => c.id),
  );
}

/** Files each fixed-yield shortfall by store and distance, and counts whether the growing realm still runs short. */
function sortForecast(forecast: Forecast) {
  for (const store of ['food', 'gold'] as const) {
    const days = forecast.lasts[store];
    if (days === undefined) continue;
    const key = bandKey(store, BANDS.find((limit) => days <= limit) ?? Infinity);
    const row = sorted.get(key) ?? { growthWarns: 0, growthClears: 0 };
    if (forecast.short[store] !== undefined) row.growthWarns++;
    else row.growthClears++;
    sorted.set(key, row);
  }
}

if (values.sort) {
  console.log(
    '\nDays Rome could pay for a raise on which the fixed-yield forecast runs short, by store and distance. A blocked raise counts again each day it waits:\n',
  );
  console.log(
    '| fixed-yield shortfall | the growing realm runs short too | growth closes the gap first |',
  );
  console.log('| --- | ---: | ---: |');
  for (const [key, row] of sorted)
    console.log(`| ${key} | ${row.growthWarns} | ${row.growthClears} |`);
}

function bandKey(store: string, band: number): string {
  return `${store} ${band === Infinity ? 'over 1,460' : `up to ${band.toLocaleString('en-US')}`} days`;
}

if (values.audit) {
  console.log(
    '\nEvery raise Rome made, scored by each rule against what followed: did food or gold run short within two or four years of it?\n',
  );
  console.log(
    '| warning rule | raises it warns of | short within 2 y | within 4 y | raises it lets pass | short within 2 y | within 4 y |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, warns] of Object.entries(RULES)) {
    if (name === 'none') continue;
    const within = (list: typeof audited, days: number) =>
      list.filter((e) => e.shortOn !== undefined && e.shortOn - e.day <= days).length;
    const warned = audited.filter((e) => warns(e.forecast));
    const passed = audited.filter((e) => !warns(e.forecast));
    console.log(
      `| ${name} | ${warned.length} | ${within(warned, 730)} | ${within(warned, 1460)} | ${passed.length} | ${within(passed, 730)} | ${within(passed, 1460)} |`,
    );
  }
}
