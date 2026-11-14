import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  alertsOfDay,
  groupAlerts,
  sightingsOfDay,
  weakSiegeNews,
  type WeakSiege,
} from '../src/app/alerts.ts';
import { alertsInSight } from '../src/app/sighted.ts';
import { worldNewsOfDay } from '../src/app/world-news.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { FactionId, SiegeId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import { sightOf } from '../src/sim/sight.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * How often the player, Rome, hears nothing: the news of each day that the corner list
 * shows, the world's news included, is worked out as the page works it out, and the days
 * with none are counted, while Rome is still in the game.
 * Rome either gives no orders or plays under the faction AI.
 */

const { values } = parseArgs({
  options: { seeds: { type: 'string', default: '10' }, years: { type: 'string', default: '5' } },
});
const SEEDS = Number(values.seeds);
const DAYS = Number(values.years) * 365;
const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;

function play(seed: number, passive: boolean) {
  let state = newGame(map, { seed, player: 'rome' });
  let watched = new Map<SiegeId, WeakSiege>();
  let silent = 0;
  let run = 0;
  let longest = 0;
  let played = 0;
  let attackedOn: number | undefined;
  for (let day = 0; day < DAYS && state.factions[rome]?.defeatedOn === null; day++) {
    const before = state;
    const result = tick(before, decideAll(before, world, passive ? [rome] : []), world);
    const after = result.state;
    if (
      attackedOn === undefined &&
      result.events.some((event) => event.kind === 'warDeclared' && event.against === rome)
    ) {
      attackedOn = before.day;
    }
    const saw = sightOf(before, world, rome);
    const sees = sightOf(after, world, rome);
    const weak = weakSiegeNews(before, after, watched);
    watched = weak.watched;
    const news = groupAlerts([
      ...alertsInSight(alertsOfDay(before, after, result.events), saw, sees),
      ...sightingsOfDay(before, after, saw, sees, world),
      ...weak.alerts,
      ...worldNewsOfDay(before, after, result.events, world).filter(
        (alert) => alert.world !== 'chronicle',
      ),
    ]);
    played++;
    if (news.length === 0) {
      silent++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
    state = after;
  }
  return { silent, longest, played, attackedOn };
}

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;
console.log(
  `Days without news for the player, Rome, over ${DAYS / 365} years, seeds 1 to ${SEEDS}.\n`,
);
console.log(
  '| Rome | days played, median | days without news, median | share | longest stretch, median | longest stretch, most | war first declared on Rome, median day | latest | seeds never attacked |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const passive of [true, false]) {
  const games = Array.from({ length: SEEDS }, (_, i) => play(i + 1, passive));
  const share = games.reduce((s, g) => s + g.silent, 0) / games.reduce((s, g) => s + g.played, 0);
  const attacked = games.flatMap((g) => (g.attackedOn === undefined ? [] : [g.attackedOn]));
  console.log(
    `| ${passive ? 'gives no orders' : 'under the AI'} | ${median(games.map((g) => g.played))} | ${median(games.map((g) => g.silent))} | ${Math.round(share * 100)}% | ${median(games.map((g) => g.longest))} | ${Math.max(...games.map((g) => g.longest))} | ${median(attacked)} | ${Math.max(0, ...attacked)} | ${games.length - attacked.length} |`,
  );
}
