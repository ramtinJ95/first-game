import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { bestTrade } from '../../src/sim/ai/trade.ts';
import { buildRefusal } from '../../src/sim/buildings/build.ts';
import { BUILDING_KINDS, BUILDINGS } from '../../src/sim/buildings/buildings.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import { expectConsistent } from '../../src/sim/references.ts';
import { dailyBalances, limitsOf, menOf, UPKEEP_PER_MAN } from '../../src/sim/systems/economy.ts';
import { tick } from '../../src/sim/tick.ts';
import { tradeForecast, tradeIncome } from '../../src/sim/trade/routes.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

const { values } = parseArgs({ options: { seeds: { type: 'string', default: '20' } } });
const seeds = Number(values.seeds);
if (!Number.isInteger(seeds) || seeds < 1) throw new Error('seeds must be a positive integer');
const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? Infinity;
const rows: number[][] = [];
console.log('Peaceful Rome; other factions give no orders (same control as sim:buildings).');
console.log(
  'Policy: best affordable route first, otherwise cheapest available building; no recruitment or wars.',
);
console.log(
  'Trade share is gross expected receipts / (taxes + trade) on day 1095; war loss uses net income.',
);
console.log(
  '| seed | trade % Y3 | cap days Y2–5 | median decision gap | payback years min–max | largest partner war loss % | decisions |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (let seed = 1; seed <= seeds; seed++) {
  let state = newGame(map, { seed, player: 'rome' });
  let capDays = 0;
  let share = 0;
  let warLoss = 0;
  const decisions: number[] = [];
  const paybacks: number[] = [];
  for (let day = 1; day <= 5 * 365; day++) {
    const orders: Order[] = [];
    const route = bestTrade(state, world, rome);
    if (route?.kind === 'openTrade') {
      const from = state.cities[route.from];
      const to = state.cities[route.to];
      const forecast = from && to && tradeForecast(state, world, from, to, route.mode);
      if (!forecast) throw new Error('best trade has no forecast');
      paybacks.push(forecast.paybackDays / 365);
      orders.push(route);
    } else {
      const buildings = Object.values(state.cities)
        .filter((c) => c.owner === rome)
        .flatMap((city) =>
          BUILDING_KINDS.filter((kind) => !buildRefusal(state, city, kind)).map((building) => ({
            city: city.id,
            building,
          })),
        )
        .sort(
          (a, b) =>
            BUILDINGS[a.building].gold - BUILDINGS[b.building].gold || a.city.localeCompare(b.city),
        );
      const first = buildings[0];
      if (first) orders.push({ kind: 'build', faction: rome, ...first });
    }
    if (orders.length) decisions.push(day);
    const result = tick(state, orders, world);
    if (result.rejected.length) throw new Error(JSON.stringify(result.rejected));
    state = result.state;
    if (
      day >= 366 &&
      (state.factions[rome]?.stores.gold ?? 0) >=
        (limitsOf(state).get(rome)?.gold ?? Infinity) - 0.001
    )
      capDays++;
    if (day === 1095) {
      const income = tradeIncome(state).get(rome) ?? 0;
      const net = dailyBalances(state).get(rome)?.gold ?? 0;
      const upkeep = Object.values(state.armies)
        .filter((a) => a.owner === rome)
        .reduce((sum, a) => sum + menOf(state, a) * UPKEEP_PER_MAN.gold, 0);
      share = (100 * income) / (net + upkeep);
      const partners = new Set(
        Object.values(state.tradeRoutes).flatMap((r) =>
          r.owner === rome && r.partner !== rome
            ? [r.partner]
            : r.partner === rome && r.owner !== rome
              ? [r.owner]
              : [],
        ),
      );
      for (const partner of partners) {
        const warring = tick(
          state,
          [{ kind: 'declareWar', faction: rome, against: partner }],
          world,
        ).state;
        warLoss = Math.max(
          warLoss,
          (100 * (net - (dailyBalances(warring).get(rome)?.gold ?? 0))) / net,
        );
      }
    }
  }
  expectConsistent(state);
  const gaps = decisions.slice(1).map((day, i) => day - (decisions[i] ?? 0));
  const gap = median(gaps);
  const low = Math.min(...paybacks);
  const high = Math.max(...paybacks);
  rows.push([share, capDays, gap, low, high, warLoss]);
  console.log(
    `| ${seed} | ${share.toFixed(1)} | ${capDays} | ${gap} | ${low.toFixed(2)}–${high.toFixed(2)} | ${warLoss.toFixed(1)} | ${decisions.length} |`,
  );
}
console.log('\n| target | result | met |\n| --- | --- | --- |');
const checks = [
  [
    'Trade 20–40% at Y3',
    `${Math.min(...rows.map((r) => r[0] ?? 0)).toFixed(1)}–${Math.max(...rows.map((r) => r[0] ?? 0)).toFixed(1)}%`,
    rows.every((r) => (r[0] ?? 0) >= 20 && (r[0] ?? 0) <= 40),
  ],
  [
    'Cap fewer than 30 days Y2–5',
    `max ${Math.max(...rows.map((r) => r[1] ?? 0))}`,
    rows.every((r) => (r[1] ?? Infinity) < 30),
  ],
  [
    'Median decision gap ≤60 days',
    `median ${median(rows.map((r) => r[2] ?? Infinity))}`,
    median(rows.map((r) => r[2] ?? Infinity)) <= 60,
  ],
  [
    'Suitable routes repay in 1–3 years',
    `${Math.min(...rows.map((r) => r[3] ?? 0)).toFixed(2)}–${Math.max(...rows.map((r) => r[4] ?? 0)).toFixed(2)} years`,
    rows.every((r) => (r[3] ?? 0) >= 1 && (r[4] ?? Infinity) <= 3),
  ],
  [
    'Partner war cuts income ≥10%',
    `min ${Math.min(...rows.map((r) => r[5] ?? 0)).toFixed(1)}%`,
    rows.every((r) => (r[5] ?? 0) >= 10),
  ],
] as const;
for (const [target, result, met] of checks)
  console.log(`| ${target} | ${result} | ${met ? 'met' : 'NOT met'} |`);
