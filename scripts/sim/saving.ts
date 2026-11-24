import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { menUnderArms } from '../../src/sim/ai/situation.ts';
import { BUILDINGS } from '../../src/sim/buildings/buildings.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { tick } from '../../src/sim/tick.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

/**
 * Plays the new game under the AI, every power with it as `sim:world` does, and records each
 * great power's men each day, the buildings it finishes, the days it saves for one, every
 * change of a city's owner, and every war. `--out` writes one game a line. `--compare
 * <before> <after>` reads two such files, from `main` and from this branch, and prints what
 * the AI built and how long it saved, its men by year, the wars that began while a power
 * saved or within a year after with what it lost or failed to take there against `main`,
 * the largest power's cities, and the wars between great powers by year.
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

type Tier = 'first' | 'second' | 'work';

interface War {
  a: string;
  b: string;
  by: string;
  from: number;
  to: number | null;
}

interface Game {
  seed: number;
  days: number;
  powers: string[];
  /** men[power][day]: the men under arms at the start of each day. */
  men: Record<string, number[]>;
  owners: { day: number; city: string; from: string; to: string }[];
  wars: War[];
  built: { day: number; power: string; tier: Tier }[];
  /** The days each power saved, as [first, last] spans. */
  saving: Record<string, [number, number][]>;
  minors: string[];
}

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const savingRule = await import('../../src/sim/ai/saving.ts').catch(() => undefined);

function tierOf(kind: string): Tier {
  const row = BUILDINGS[kind as keyof typeof BUILDINGS] as { needs: { building?: string } };
  if (['treasuryHall', 'merchantsQuarter', 'stronghold'].includes(kind)) return 'work';
  return row.needs.building ? 'second' : 'first';
}

function play(seed: number, years: number): Game {
  const world = buildWorld(map);
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const powers = Object.values(state.factions)
    .filter((f) => f.kind === 'greatPower')
    .map((f) => f.id)
    .sort();
  const game: Game = {
    seed,
    days: years * 365,
    powers,
    men: Object.fromEntries(powers.map((p) => [p, []])),
    owners: [],
    wars: [],
    built: [],
    saving: Object.fromEntries(powers.map((p) => [p, []])),
    minors: Object.values(state.factions)
      .filter((f) => f.kind === 'minor')
      .map((f) => f.id),
  };
  const open = new Map<string, War>();
  for (let day = 0; day < years * 365; day++) {
    for (const power of powers) {
      game.men[power]?.push(Math.round(menUnderArms(state, power as FactionId)));
      if (!savingRule?.savingFor(state, world, power as FactionId)) continue;
      const spans = game.saving[power] ?? [];
      const last = spans.at(-1);
      if (last && last[1] === day - 1) last[1] = day;
      else spans.push([day, day]);
    }
    const { state: next, events } = tick(state, decideAll(state, world, []), world);
    for (const event of events) {
      if (event.kind === 'buildingFinished' && powers.includes(event.owner))
        game.built.push({ day, power: event.owner, tier: tierOf(event.building) });
      if (event.kind === 'warDeclared') {
        const war = { a: event.by, b: event.against, by: event.by, from: day, to: null };
        open.set([event.by, event.against].sort().join('|'), war);
        game.wars.push(war);
      }
    }
    for (const city of Object.values(next.cities)) {
      const was = state.cities[city.id]?.owner;
      if (was && was !== city.owner)
        game.owners.push({ day, city: city.id, from: was, to: city.owner });
    }
    const atWar = new Set(
      Object.keys(next.wars).map((k) => (JSON.parse(k) as string[]).sort().join('|')),
    );
    for (const [key, war] of open)
      if (!atWar.has(key)) {
        war.to = day;
        open.delete(key);
      }
    state = next;
  }
  return game;
}

function ownersOn(seed: number, game: Game, day: number): Record<string, string> {
  const owners: Record<string, string> = Object.fromEntries(
    Object.values(newGame(map, { seed, player: 'rome' }).cities).map((c) => [c.id, c.owner]),
  );
  for (const change of game.owners) if (change.day <= day) owners[change.city] = change.to;
  return owners;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};
const whole = (n: number) => Math.round(n).toLocaleString('en-US');

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
  const seeds = [...after.keys()].filter((s) => before.has(s)).sort((a, b) => a - b);
  const pairs = seeds.map((s) => [before.get(s), after.get(s)] as [Game, Game]);
  const powers = [...new Set(pairs.flatMap(([, g]) => g.powers))].sort();
  const years = Math.round((pairs[0]?.[1].days ?? 3650) / 365);
  console.log(
    `# Saving for the next building, seeds ${seeds[0]} to ${seeds.at(-1)}, \`main\` → this branch\n`,
  );

  console.log('## 1. What the AI builds by the end of the game, and how long it saves\n');
  console.log('Totals over the seeds. Days saving is the share of its days a power saved.\n');
  console.log('| power | first levels | second levels | great works | days saving |');
  console.log('| --- | --- | --- | --- | --- |');
  const tiers = (g: Game, power: string, tier: Tier) =>
    g.built.filter((b) => b.power === power && b.tier === tier).length;
  for (const power of powers) {
    const sum = (i: 0 | 1, tier: Tier) => pairs.reduce((n, p) => n + tiers(p[i], power, tier), 0);
    const days = pairs.reduce(
      (n, [, g]) => n + (g.saving[power] ?? []).reduce((m, [a, b]) => m + b - a + 1, 0),
      0,
    );
    const share = (100 * days) / pairs.reduce((n, [, g]) => n + g.days, 0);
    console.log(
      `| ${power} | ${sum(0, 'first')} → ${sum(1, 'first')} | ${sum(0, 'second')} → ${sum(1, 'second')} | ${sum(0, 'work')} → ${sum(1, 'work')} | ${share.toFixed(0)} % |`,
    );
  }

  console.log('\n## 2. Men under arms at the end of each year, median over the seeds\n');
  console.log(
    `| power | ${Array.from({ length: years }, (_, y) => `year ${y + 1}`).join(' | ')} |`,
  );
  console.log(`| --- | ${Array.from({ length: years }, () => '---').join(' | ')} |`);
  for (const power of powers) {
    const at = (i: 0 | 1, y: number) =>
      median(pairs.map((p) => p[i].men[power]?.[(y + 1) * 365 - 1] ?? 0));
    console.log(
      `| ${power} | ${Array.from({ length: years }, (_, y) => `${whole(at(0, y))} → ${whole(at(1, y))}`).join(' | ')} |`,
    );
  }

  console.log('\n## 3. Wars that began while a power saved or within a year after\n');
  console.log(
    "Each war of a power that saved, against a great power or a minor. Lost: cities it lost to that enemy in the war which it holds on `main` the day the war ended (or at the end). Not taken: that enemy's cities it holds on `main` that day but not here.\n",
  );
  const rows: Record<
    'greatPower' | 'minor',
    { wars: number; lost: number; missed: number; worse: number }
  > = {
    greatPower: { wars: 0, lost: 0, missed: 0, worse: 0 },
    minor: { wars: 0, lost: 0, missed: 0, worse: 0 },
  };
  const details: string[] = [];
  for (const [m, g] of pairs) {
    for (const power of g.powers) {
      const spans = g.saving[power] ?? [];
      for (const war of g.wars) {
        if (war.a !== power && war.b !== power) continue;
        if (!spans.some(([a, b]) => war.from >= a && war.from <= b + 365)) continue;
        const other = war.a === power ? war.b : war.a;
        const kind = g.minors.includes(other) ? 'minor' : 'greatPower';
        const end = war.to ?? g.days - 1;
        const here = ownersOn(g.seed, g, end);
        const there = ownersOn(m.seed, m, end);
        const lost = g.owners.filter(
          (c) =>
            c.from === power &&
            c.to === other &&
            c.day >= war.from &&
            c.day <= end &&
            there[c.city] === power,
        ).length;
        const theirs = Object.entries(ownersOn(g.seed, g, war.from))
          .filter(([, owner]) => owner === other)
          .map(([city]) => city);
        const missed = theirs.filter((c) => there[c] === power && here[c] !== power).length;
        const row = rows[kind];
        row.wars += 1;
        row.lost += lost;
        row.missed += missed;
        if (lost + missed > 0) {
          row.worse += 1;
          details.push(
            `| ${g.seed} | ${power} | ${other} | ${war.by} | ${war.from} | ${war.to ?? 'running'} | ${lost} | ${missed} |`,
          );
        }
      }
    }
  }
  console.log(
    '| against | wars | wars with a loss against `main` | cities lost held on `main` | cities not taken that `main` takes |',
  );
  console.log('| --- | --- | --- | --- | --- |');
  for (const kind of ['greatPower', 'minor'] as const)
    console.log(
      `| ${kind === 'greatPower' ? 'a great power' : 'a minor'} | ${rows[kind].wars} | ${rows[kind].worse} | ${rows[kind].lost} | ${rows[kind].missed} |`,
    );
  if (details.length) {
    console.log('\n| seed | power | enemy | declared by | from day | to day | lost | not taken |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const line of details) console.log(line);
  }

  console.log(
    "\n## 4. The largest power's cities at the end of years 5 and 10, median over the seeds\n",
  );
  const largest = (g: Game, day: number) => {
    const counts = new Map<string, number>();
    for (const owner of Object.values(ownersOn(g.seed, g, day)))
      if (g.powers.includes(owner)) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    return Math.max(0, ...counts.values());
  };
  for (const y of [5, 10].filter((y) => y <= years))
    console.log(
      `- Year ${y}: ${median(pairs.map((p) => largest(p[0], y * 365 - 1)))} → ${median(pairs.map((p) => largest(p[1], y * 365 - 1)))}; most ${Math.max(...pairs.map((p) => largest(p[0], y * 365 - 1)))} → ${Math.max(...pairs.map((p) => largest(p[1], y * 365 - 1)))}.`,
    );

  console.log('\n## 5. Wars declared between great powers, by year, all seeds\n');
  console.log(
    `| | ${Array.from({ length: years }, (_, y) => `year ${y + 1}`).join(' | ')} | all |`,
  );
  console.log(`| --- | ${Array.from({ length: years }, () => '---').join(' | ')} | --- |`);
  for (const [label, i] of [
    ['main', 0],
    ['this branch', 1],
  ] as const) {
    const counts = Array.from({ length: years }, (_, y) =>
      pairs.reduce(
        (n, p) =>
          n +
          p[i].wars.filter(
            (w) =>
              Math.floor(w.from / 365) === y &&
              p[i].powers.includes(w.a) &&
              p[i].powers.includes(w.b),
          ).length,
        0,
      ),
    );
    console.log(`| ${label} | ${counts.join(' | ')} | ${counts.reduce((a, b) => a + b, 0)} |`);
  }
}

if (values.compare) {
  const [beforePath, afterPath] = positionals;
  if (!beforePath || !afterPath) throw new Error('--compare <before.jsonl> <after.jsonl>');
  compare(beforePath, afterPath);
} else {
  const lines: string[] = [];
  const from = Number(values.from);
  for (let seed = from; seed < from + Number(values.seeds); seed++) {
    const game = play(seed, Number(values.years));
    lines.push(JSON.stringify(game));
    console.log(
      `seed ${seed}: ${game.built.length} buildings, ${game.built.filter((b) => b.tier === 'work').length} great works`,
    );
  }
  if (values.out) writeFileSync(values.out, lines.join('\n') + '\n');
}
