import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  alertsOfDay,
  groupAlerts,
  sightingsOfDay,
  weakSiegeNews,
  type Alert,
} from '../src/app/alerts.ts';
import { alertsInSight } from '../src/app/sighted.ts';
import { worldNewsOfDay } from '../src/app/world-news.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import { sightOf } from '../src/sim/sight.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * Plays the new game as Rome, once with Rome giving no orders and once with Rome under
 * the AI, and counts the lines of news the page gives each year: before world news and
 * grouped sightings, and after, split into what the corner shows and what only the
 * chronicle keeps.
 */

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '5' },
    years: { type: 'string', default: '3' },
  },
});
const SEEDS = Number(values.seeds);
const YEARS = Number(values.years);
const YEAR = 365;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

interface Year {
  before: number;
  corner: number;
  chronicle: number;
  kinds: Map<string, number>;
}

/** "5 fleets of Carthage ..." stood for five lines before sightings were grouped. */
function linesBefore(alert: Alert): number {
  if (alert.kind !== 'enemySighted') return 1;
  return Number(/^(\d+) (?:fleets|armies) of /.exec(alert.text)?.[1] ?? 1);
}

function play(seed: number, active: boolean): Year[] {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  let weak = new Map();
  const years: Year[] = [];
  for (let day = 1; day <= YEARS * YEAR; day++) {
    const year = Math.floor((day - 1) / YEAR);
    const counts = (years[year] ??= { before: 0, corner: 0, chronicle: 0, kinds: new Map() });
    const orders = decideAll(state, world, active ? [] : [state.player]);
    const { state: next, events } = tick(state, orders, world);
    const saw = sightOf(state, world, state.player);
    const sees = sightOf(next, world, state.player);
    const weakNews = weakSiegeNews(state, next, weak);
    weak = weakNews.watched;
    const own = groupAlerts([
      ...alertsInSight(alertsOfDay(state, next, events), saw, sees),
      ...sightingsOfDay(state, next, saw, sees, world),
      ...weakNews.alerts,
    ]);
    const news = worldNewsOfDay(state, next, events);
    counts.before += own.reduce((sum, alert) => sum + linesBefore(alert), 0);
    for (const alert of groupAlerts([...own, ...news])) {
      if (alert.world === 'chronicle') counts.chronicle++;
      else counts.corner++;
      if (alert.world) counts.kinds.set(alert.kind, (counts.kinds.get(alert.kind) ?? 0) + 1);
    }
    state = next;
  }
  return years;
}

for (const active of [false, true]) {
  console.log(
    `\nRome ${active ? 'under the AI' : 'giving no orders'}, ${SEEDS} seeds, lines a year`,
  );
  console.log('seed  year  before  after: corner  chronicle only  world news by kind');
  const total = { before: 0, corner: 0, chronicle: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    play(seed, active).forEach((year, i) => {
      total.before += year.before;
      total.corner += year.corner;
      total.chronicle += year.chronicle;
      const kinds = [...year.kinds].map(([kind, n]) => `${kind} ${n}`).join(', ');
      console.log(
        `${String(seed).padStart(4)}  ${String(i + 1).padStart(4)}  ${String(year.before).padStart(6)}  ${String(year.corner).padStart(13)}  ${String(year.chronicle).padStart(14)}  ${kinds}`,
      );
    });
  }
  const years = SEEDS * YEARS;
  console.log(
    `mean        ${(total.before / years).toFixed(1).padStart(6)}  ${(total.corner / years).toFixed(1).padStart(13)}  ${(total.chronicle / years).toFixed(1).padStart(14)}`,
  );
}
