import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '10' },
  },
});
const first = Number(values.from);
const last = first + Number(values.seeds) - 1;
const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

console.log(
  `Every faction under the AI, ${values.years} years, seeds ${first} to ${last}: each raid on a land road, by whether the raider was at war with both ends' owners or with one only, taking the cargo the other shares.\n`,
);
console.log(
  '| seed | raids | at war with both ends | at war with one end only | of those, on a road with a Roman end |',
);
console.log('| ---: | ---: | ---: | ---: | ---: |');
const total = { raids: 0, both: 0, one: 0, rome: 0 };
for (let seed = first; seed <= last; seed++) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const row = { raids: 0, both: 0, one: 0, rome: 0 };
  for (let day = 0; day < Number(values.years) * 365; day++) {
    const { state: next, events } = tick(state, decideAll(state, world), world);
    for (const e of events) {
      if (e.kind !== 'tradeRaided' || e.cause !== 'raid') continue;
      row.raids++;
      const [a, b] = e.owners;
      if (areAtWar(next, e.raider, a) && areAtWar(next, e.raider, b)) row.both++;
      else {
        row.one++;
        if (e.owners.includes(next.player)) row.rome++;
      }
    }
    state = next;
  }
  for (const key of ['raids', 'both', 'one', 'rome'] as const) total[key] += row[key];
  console.log(`| ${seed} | ${row.raids} | ${row.both} | ${row.one} | ${row.rome} |`);
}
console.log(`| all | ${total.raids} | ${total.both} | ${total.one} | ${total.rome} |`);
