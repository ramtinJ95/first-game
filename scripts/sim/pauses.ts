import { readFileSync } from 'node:fs';
import { alertsOfDay, sightingsOfDay, weakSiegeNews } from '../../src/app/alerts.ts';
import { ALL_PAUSES, stopsOfDay } from '../../src/app/pauses.ts';
import { alertsInSight } from '../../src/app/sighted.ts';
import { turningPoints } from '../../src/app/turning-points.ts';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import { sightOf } from '../../src/sim/sight.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

// Count stops, immediately resuming each one without orders, as an idle player would.
const map = parseMap(JSON.parse(readFileSync('data/map/map.json', 'utf8')));
const world = buildWorld(map);
for (let seed = 1; seed <= 5; seed++) {
  let state = newGame(map, { seed, player: 'rome' });
  let told = new Set<string>();
  let weak = new Map();
  let pauses = 0;
  let lostCities = 0;
  let stoppedLosses = 0;
  const reasons = new Map<string, number>();
  for (let day = 0; day < 4 * 365; day++) {
    const { state: next, events } = tick(state, decideAll(state, world), world);
    const saw = sightOf(state, world, state.player);
    const sees = sightOf(next, world, next.player);
    const watched = weakSiegeNews(state, next, weak);
    weak = watched.watched;
    const stops = stopsOfDay(
      [
        ...alertsInSight(alertsOfDay(state, next, events, undefined, told), saw, sees),
        ...sightingsOfDay(state, next, saw, sees, world, told),
        ...watched.alerts,
      ],
      ALL_PAUSES,
      told,
    );
    told = stops.told;
    const modals = turningPoints(state, next, world);
    const stopped = stops.stop || modals.length > 0;
    if (stopped) pauses++;
    for (const alert of stops.news) {
      if (alert.kind === 'cityChangedOwner' && alert.tone === 'bad') {
        lostCities++;
        if (stopped) stoppedLosses++;
      }
      if (alert.paused) reasons.set(alert.kind, (reasons.get(alert.kind) ?? 0) + 1);
    }
    for (const point of modals) reasons.set(point.kind, (reasons.get(point.kind) ?? 0) + 1);
    state = next;
    if (state.factions[state.player]?.defeatedOn !== null) break;
  }
  console.log(
    JSON.stringify({
      seed,
      pauses,
      lostCities,
      stoppedLosses,
      reasons: Object.fromEntries(reasons),
    }),
  );
}
