import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { alertsOfDay, groupAlerts } from '../../src/app/alerts.ts';
import { alertsInSight } from '../../src/app/sighted.ts';
import { tradeNews, type TradeTrouble } from '../../src/app/trade-news.ts';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import { sightOf } from '../../src/sim/sight.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

/**
 * Plays the new game as Rome, idle and under the AI, and counts the lines of trade news
 * the page gives the player, by kind, beside the raids and sieges that interrupted the
 * player's routes, which each took a line of their own before `tradeNews` told episodes.
 */

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '5' },
    years: { type: 'string', default: '10' },
    mode: { type: 'string', default: 'both' },
  },
});
const SEEDS = Number(values.seeds);
const DAYS = Number(values.years) * 365;
const modes = values.mode === 'both' ? [false, true] : [values.mode === 'ai'];

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

function play(seed: number, active: boolean) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const lines = new Map<string, number>();
  const raw = { raid: 0, siege: 0 };
  let troubles: TradeTrouble[] = [];
  for (let day = 1; day <= DAYS; day++) {
    const orders = decideAll(state, world, active ? [] : [state.player]);
    const { state: next, events } = tick(state, orders, world);
    for (const event of events) {
      if (event.kind === 'tradeRaided' && event.owners.includes(state.player))
        raw[event.cause === 'siege' ? 'siege' : 'raid']++;
    }
    const trade = tradeNews(state, next, events, troubles);
    troubles = trade.watched;
    const own = groupAlerts([
      ...alertsInSight(
        alertsOfDay(state, next, events),
        sightOf(state, world, state.player),
        sightOf(next, world, state.player),
      ),
      ...trade.alerts,
    ]);
    for (const alert of own) {
      if (!alert.kind.startsWith('trade')) continue;
      lines.set(alert.kind, (lines.get(alert.kind) ?? 0) + 1);
    }
    state = next;
  }
  return { lines, raw };
}

for (const active of modes) {
  console.log(`\nRome ${active ? 'under the AI' : 'idle'}, ${values.years} years: trade lines`);
  let sum = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { lines, raw } = play(seed, active);
    const total = [...lines.values()].reduce((a, b) => a + b, 0);
    sum += total;
    const kinds = [...lines].map(([kind, n]) => `${kind} ${n}`).join(', ');
    console.log(
      `seed ${seed}: ${total} lines (${kinds}); raw interruptions: ${raw.raid} raids, ${raw.siege} sieges`,
    );
  }
  console.log(`mean ${(sum / SEEDS).toFixed(1)} lines per game`);
}
