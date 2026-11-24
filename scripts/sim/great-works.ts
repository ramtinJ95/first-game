import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { menUnderArms } from '../../src/sim/ai/situation.ts';
import { GREAT_WORKS } from '../../src/sim/buildings/buildings.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

/**
 * Plays the new game under the AI, every power with it, as `sim:world` does, and records
 * each day's men of each great power, each change of a city's owner, each war, each great
 * work ordered and finished, and the days each power saved for one. `--out` writes one
 * game a line. `--compare <before> <after>` reads two such files, from `main` and from this
 * branch, and prints the great works the AI built, what saving cost each power in men and
 * how long it took to catch up, and the wars that began while a power saved or within a
 * year after, with the cities it lost there that it still holds on `main`.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '10' },
    out: { type: 'string' },
    compare: { type: 'boolean', default: false },
  },
});

interface War {
  a: string;
  b: string;
  by: string;
  from: number;
  to: number | null;
}

interface Game {
  seed: number;
  powers: string[];
  /** men[power][day], the men under arms at the start of each day. */
  men: Record<string, number[]>;
  owners: { day: number; city: string; from: string; to: string }[];
  wars: War[];
  ordered: { day: number; power: string; city: string; work: string }[];
  finished: { day: number; power: string; city: string; work: string }[];
  /** The days each power saved for a great work, as [first, last] spans. */
  saving: Record<string, [number, number][]>;
}

const WORKS = new Set<string>(GREAT_WORKS);

async function play(seed: number, years: number): Promise<Game> {
  const savingModule = await import('../../src/sim/ai/saving.ts').catch(() => undefined);
  const map = parseMap(
    JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
  );
  const world = buildWorld(map);
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const powers = Object.values(state.factions)
    .filter((f) => f.kind === 'greatPower')
    .map((f) => f.id)
    .sort();
  const game: Game = {
    seed,
    powers,
    men: Object.fromEntries(powers.map((p) => [p, []])),
    owners: [],
    wars: [],
    ordered: [],
    finished: [],
    saving: Object.fromEntries(powers.map((p) => [p, []])),
  };
  const open = new Map<string, War>();
  for (let day = 0; day < years * 365; day++) {
    for (const power of powers) {
      game.men[power]?.push(Math.round(menUnderArms(state, power as FactionId)));
      const saves = savingModule?.savingFor(state, world, power as FactionId);
      const spans = game.saving[power] ?? [];
      const last = spans.at(-1);
      if (saves) {
        if (last && last[1] === state.day - 1) last[1] = state.day;
        else spans.push([state.day, state.day]);
      }
    }
    const orders = decideAll(state, world, []);
    const { state: next, events, rejected } = tick(state, orders, world);
    for (const order of orders)
      if (
        order.kind === 'build' &&
        WORKS.has(order.building) &&
        !rejected.some((r) => r.order === order)
      )
        game.ordered.push({
          day: state.day,
          power: order.faction,
          city: order.city,
          work: order.building,
        });
    for (const event of events)
      if (event.kind === 'buildingFinished' && WORKS.has(event.building))
        game.finished.push({
          day: next.day,
          power: event.owner,
          city: event.city,
          work: event.building,
        });
    for (const city of Object.values(next.cities)) {
      const was = state.cities[city.id]?.owner;
      if (was && was !== city.owner)
        game.owners.push({ day: next.day, city: city.id, from: was, to: city.owner });
    }
    for (const event of events)
      if (event.kind === 'warDeclared') {
        const war = { a: event.by, b: event.against, by: event.by, from: next.day, to: null };
        open.set([event.by, event.against].sort().join('|'), war);
        game.wars.push(war);
      }
    for (const [key, war] of open)
      if (!Object.keys(next.wars).some((k) => k.split('|').sort().join('|') === key)) {
        war.to = next.day;
        open.delete(key);
      }
    state = next;
  }
  return game;
}

/** The owner of each city on `day`, replayed from the start's owners and the changes. */
function ownersOn(start: Record<string, string>, game: Game, day: number): Record<string, string> {
  const owners = { ...start };
  for (const change of game.owners) if (change.day <= day) owners[change.city] = change.to;
  return owners;
}

function compare(beforePath: string, afterPath: string) {
  const read = (path: string) =>
    new Map(
      readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Game)
        .map((g) => [g.seed, g]),
    );
  const before = read(beforePath);
  const after = read(afterPath);
  const map = parseMap(
    JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
  );
  const seeds = [...after.keys()].sort((a, b) => a - b);
  console.log(
    `## Great works the AI powers finished by year 10, seeds ${seeds[0]} to ${seeds.at(-1)}\n`,
  );
  const count = (games: Map<number, Game>) => {
    const counts = new Map<string, number>();
    for (const g of games.values())
      for (const w of g.finished)
        counts.set(`${w.power}|${w.work}`, (counts.get(`${w.power}|${w.work}`) ?? 0) + 1);
    return counts;
  };
  const was = count(before);
  const now = count(after);
  const powers = [...new Set([...after.values()].flatMap((g) => g.powers))].sort();
  console.log(`| power | ${GREAT_WORKS.map((w) => `${w}, main → this`).join(' | ')} |`);
  console.log(`| --- | ${GREAT_WORKS.map(() => '---').join(' | ')} |`);
  for (const power of powers)
    console.log(
      `| ${power} | ${GREAT_WORKS.map((w) => `${was.get(`${power}|${w}`) ?? 0} → ${now.get(`${power}|${w}`) ?? 0}`).join(' | ')} |`,
    );

  console.log('\n## What saving cost in men\n');
  console.log(
    "For each great work a power ordered after saving for it: its men that day, the same power's men on the same day of the same seed on `main`, and the days until its men stood again at or above `main`'s.\n",
  );
  console.log(
    '| seed | power | work | saved from day | ordered on day | men | men on main | caught up after |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const shortfalls: number[] = [];
  const catchUps: number[] = [];
  let never = 0;
  for (const seed of seeds) {
    const g = after.get(seed);
    const m = before.get(seed);
    if (!g || !m) continue;
    for (const order of g.ordered) {
      const span = (g.saving[order.power] ?? []).find(
        ([first, last]) => first <= order.day && last >= order.day - 1,
      );
      if (!span) continue;
      const men = g.men[order.power]?.[order.day] ?? 0;
      const mainMen = m.men[order.power]?.[order.day] ?? 0;
      let caught: number | undefined;
      for (let day = order.day; day < (g.men[order.power]?.length ?? 0); day++)
        if ((g.men[order.power]?.[day] ?? 0) >= (m.men[order.power]?.[day] ?? 0)) {
          caught = day - order.day;
          break;
        }
      shortfalls.push(mainMen - men);
      if (caught === undefined) never += 1;
      else catchUps.push(caught);
      console.log(
        `| ${seed} | ${order.power} | ${order.work} | ${span[0]} | ${order.day} | ${men} | ${mainMen} | ${caught === undefined ? 'not by year 10' : `${caught} days`} |`,
      );
    }
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
  };
  console.log(
    `\nMen short of \`main\` on the day of the order: median ${median(shortfalls)}, most ${Math.max(0, ...shortfalls)}, over ${shortfalls.length} works. Caught up after a median ${median(catchUps)} days; not by year 10: ${never}.`,
  );

  console.log('\n## Wars that began while a power saved, or within a year after\n');
  console.log(
    'For each such war of a saving power: who declared it, the cities the power lost in it, and of those how many it still holds on `main` on the day the war ended (or year 10). Beside it, the first war declared on the power on `main` after the same day.\n',
  );
  console.log(
    '| seed | power | war with | declared by | from day | on main, first war on it after that day | cities lost | of them held on main |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  let lostHeld = 0;
  let wars = 0;
  for (const seed of seeds) {
    const g = after.get(seed);
    const m = before.get(seed);
    if (!g || !m) continue;
    const start = Object.fromEntries(
      Object.values(newGame(map, { seed, player: 'rome' }).cities).map((c) => [c.id, c.owner]),
    );
    for (const power of g.powers) {
      const spans = g.saving[power] ?? [];
      for (const war of g.wars) {
        if (war.a !== power && war.b !== power) continue;
        const inSpan = spans.some(([first, last]) => war.from >= first && war.from <= last + 365);
        if (!inSpan) continue;
        wars += 1;
        const other = war.a === power ? war.b : war.a;
        const end = war.to ?? g.men[power]?.length ?? 0;
        const lost = g.owners.filter(
          (c) => c.from === power && c.to === other && c.day >= war.from && c.day <= end,
        );
        const mainOwners = ownersOn(start, m, end);
        const held = lost.filter((c) => mainOwners[c.city] === power).length;
        lostHeld += held;
        const mainFirst = m.wars.find((w) => w.b === power && w.from >= war.from);
        console.log(
          `| ${seed} | ${power} | ${other} | ${war.by} | ${war.from} | ${mainFirst ? `${mainFirst.from} by ${mainFirst.by}` : 'none'} | ${lost.length} | ${held} |`,
        );
      }
    }
  }
  console.log(
    `\n${wars} such wars. Cities lost in them that the same power holds on \`main\` that day: ${lostHeld}.`,
  );
}

if (values.compare) {
  const [beforePath, afterPath] = positionals;
  if (!beforePath || !afterPath) throw new Error('--compare <before.jsonl> <after.jsonl>');
  compare(beforePath, afterPath);
} else {
  const lines: string[] = [];
  const from = Number(values.from);
  for (let seed = from; seed < from + Number(values.seeds); seed++) {
    const game = await play(seed, Number(values.years));
    lines.push(JSON.stringify(game));
    const works = game.finished.map((w) => `${w.power} ${w.work} day ${w.day}`).join(', ');
    console.log(`seed ${seed}: ${works || 'no great work'}`);
  }
  if (values.out) writeFileSync(values.out, lines.join('\n') + '\n');
}
