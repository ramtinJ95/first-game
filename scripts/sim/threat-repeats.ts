import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { threatNewsOfDay } from '../../src/app/threat-news.ts';
import { warReadiness } from '../../src/sim/ai/war.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { playCautiousRome, rome, world } from '../cautious-rome.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    players: { type: 'string', default: 'ignoring,answering' },
    json: { type: 'boolean', default: false },
    summarize: { type: 'boolean', default: false },
    trail: { type: 'boolean', default: false },
    gaps: { type: 'string', default: '30,60,90,120' },
    propose: { type: 'string' },
  },
});

/** The Romes of `sim -- slide` that declare no war: one ignores each warning, one answers it. */
const PLAYERS = {
  ignoring: { peaceful: true },
  answering: { peaceful: true, answer: true },
} as const;
type Player = keyof typeof PLAYERS;

/** One power's warning as the page tells it, and whether the page stopped the game for it. */
interface Warning {
  day: number;
  power: string;
  /** Its share of the strength it needs that day, uncapped. */
  share: number;
  /** The city it weighs the player's forces at, or `field` for every army in the field. */
  front: string;
  stopped: boolean;
}

interface Game {
  player: Player;
  seed: number;
  warnings: Warning[];
  /** The days on which the page stopped for a warning, whatever the powers it named. */
  stops: number[];
  wars: { day: number; power: string }[];
}

function play(player: Player, seed: number, years: number): Game {
  const game: Game = { player, seed, warnings: [], stops: [], wars: [] };
  const told = new Set<string>();
  playCautiousRome(
    seed,
    years,
    ({ before, after, events }) => {
      const day = before.day;
      for (const alert of threatNewsOfDay(before, after, world, told)) {
        if (alert.pause) game.stops.push(day);
        for (const power of Object.keys(after.factions)) {
          if (!told.has(`threat:${power}:${day}`)) continue;
          const threat = warReadiness(after, world, power as FactionId, rome);
          game.warnings.push({
            day,
            power,
            share: threat?.readiness ?? 0,
            front: threat?.pressed ? 'field' : (threat?.front ?? ''),
            stopped: alert.pause !== undefined,
          });
        }
      }
      for (const event of events)
        if (
          event.kind === 'warDeclared' &&
          event.against === rome &&
          after.factions[event.by]?.kind === 'greatPower' &&
          areAtWar(after, event.by, rome)
        )
          game.wars.push({ day, power: event.by });
    },
    PLAYERS[player],
  );
  return game;
}

/** A share as the warning shows it, in whole points of at most 100. */
const shown = (n: number) => Math.round(Math.min(1, n) * 100);
const pct = (n: number) => `${shown(n)}%`;

/**
 * Each warning after a stop for the same power in the same peace, with the days since that
 * stop, the points its share stands above the stop's, and whether it names the same front.
 * A war on the player ends the peace, so the stop before it is not carried over.
 */
function repeats(game: Game) {
  const last = new Map<string, Warning>();
  const out: { since: number; points: number; same: boolean; stopped: boolean }[] = [];
  const events = [
    ...game.warnings.map((w) => ({ day: w.day, warning: w })),
    ...game.wars.map((w) => ({ day: w.day, war: w.power })),
  ].sort((a, b) => a.day - b.day);
  for (const event of events) {
    if ('war' in event && event.war) {
      last.delete(event.war);
      continue;
    }
    const w = 'warning' in event ? event.warning : undefined;
    if (!w) continue;
    const stop = last.get(w.power);
    if (stop)
      out.push({
        since: w.day - stop.day,
        points: shown(w.share) - shown(stop.share),
        same: w.front === stop.front,
        stopped: w.stopped,
      });
    if (w.stopped) last.set(w.power, w);
  }
  return out;
}

/** Each war on the player, with the days since the last stop for that power, or null with none in that peace. */
function warsAfterStops(game: Game) {
  return game.wars.map((war) => {
    const before = game.warnings.filter((w) => w.power === war.power && w.day <= war.day);
    const lastWar = game.wars
      .filter((w) => w.power === war.power && w.day < war.day)
      .reduce((d, w) => Math.max(d, w.day), -1);
    const stops = before.filter((w) => w.stopped && w.day > lastWar);
    const told = before.filter((w) => w.day > lastWar);
    const stop = stops.at(-1);
    return {
      ...war,
      sinceStop: stop ? war.day - stop.day : null,
      sinceWarning: told.at(-1) ? war.day - (told.at(-1)?.day ?? 0) : null,
    };
  });
}

function print(games: readonly Game[]) {
  const gaps = values.gaps.split(',').map(Number);
  for (const player of Object.keys(PLAYERS) as Player[]) {
    const mine = games.filter((g) => g.player === player);
    if (mine.length === 0) continue;
    const all = mine.flatMap(repeats);
    const stops = mine.reduce((n, g) => n + g.stops.length, 0);
    const told = mine.reduce((n, g) => n + new Set(g.warnings.map((w) => w.day)).size, 0);
    console.log(
      `\n### ${player} Rome, ${mine.length} seeds: ${told} days with a warning, ${stops} stops\n`,
    );
    console.log(
      '| within days of the power’s last stop | repeats | that stopped | share against the last stop: lower / up to +2 / +3 to +5 / +6 to +10 / more | same front | another front |',
    );
    console.log('| ---: | ---: | ---: | --- | ---: | ---: |');
    for (const gap of gaps) {
      const inside = all.filter((r) => r.since <= gap);
      const band = (lo: number, hi: number) =>
        inside.filter((r) => r.points >= lo && r.points <= hi).length;
      console.log(
        `| ${gap} | ${inside.length} | ${inside.filter((r) => r.stopped).length} | ${band(-100, -1)} / ${band(0, 2)} / ${band(3, 5)} / ${band(6, 10)} / ${band(11, 1000)} | ${inside.filter((r) => r.same).length} | ${inside.filter((r) => !r.same).length} |`,
      );
    }
    const wars = mine.flatMap(warsAfterStops);
    const late = (gap: number) =>
      wars.filter((w) => w.sinceStop === null || w.sinceStop > gap).length;
    console.log(
      `\nWars on Rome by a great power: ${wars.length}. Days from the power's last stop to its war: ${wars
        .map((w) => w.sinceStop ?? 'none')
        .sort((a, b) => Number(a) - Number(b))
        .join(', ')}.`,
    );
    console.log(
      `Wars more than each gap after the last stop for that power: ${gaps.map((g) => `${g} days ${late(g)}`).join(', ')}.`,
    );
    console.log(
      `Days from the power's last warning, stopped or not, to its war, shortest: ${Math.min(...wars.map((w) => w.sinceWarning ?? Infinity))}.`,
    );
  }
}

/** The warnings of one seed and power in order, for reading a run by eye: day, share, front, and a star where it stopped. */
function trail(games: readonly Game[]) {
  for (const game of games)
    for (const power of new Set(game.warnings.map((w) => w.power)))
      console.log(
        `${game.player} ${game.seed} ${power}: ${game.warnings
          .filter((w) => w.power === power)
          .map((w) => `${w.day}${w.stopped ? '*' : ''} ${pct(w.share)} ${w.front}`)
          .join(' · ')} | wars ${game.wars
          .filter((w) => w.power === power)
          .map((w) => w.day)
          .join(', ')}`,
      );
}

/**
 * The warnings' stops as a rule of a gap and a rise would have made them on the same games:
 * a first warning of a notice after a stop for its power in this peace runs on when it names the
 * same front, stands under `rise` points above the stop, and its war, which can come no later than
 * its reminder 84 days after it, would still fall within `gap` days of the stop. A reminder always
 * stops. The record keeps no notice, so a warning 84 or 60 days after the power's last is taken
 * for that last one's reminder.
 */
function replay(game: Game, gap: number, rise: number): Game {
  const last = new Map<string, Warning>();
  const previous = new Map<string, Warning>();
  const warnings: Warning[] = [];
  const stops: number[] = [];
  const days = [...new Set([...game.warnings, ...game.wars].map((e) => e.day))].sort(
    (a, b) => a - b,
  );
  for (const day of days) {
    for (const war of game.wars.filter((w) => w.day === day)) {
      last.delete(war.power);
      previous.delete(war.power);
    }
    const told = game.warnings
      .filter((w) => w.day === day)
      .map((w) => {
        const stop = last.get(w.power);
        const before = previous.get(w.power);
        const reminder = before !== undefined && [60, 84].includes(w.day - before.day);
        const spared =
          stop !== undefined &&
          !reminder &&
          w.front === stop.front &&
          shown(w.share) - shown(stop.share) < rise &&
          w.day + 84 - stop.day <= gap;
        return { ...w, stopped: !spared };
      });
    // One line tells every power of a day and stops for all of them if it stops for one.
    const stopped = told.some((w) => w.stopped);
    for (const w of told) {
      w.stopped = stopped;
      warnings.push(w);
      previous.set(w.power, w);
      if (stopped) last.set(w.power, w);
    }
    if (stopped) stops.push(day);
  }
  return { ...game, warnings, stops };
}

if (values.propose) {
  const games = positionals
    .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Game);
  const [gaps = '', rises = ''] = values.propose.split(':');
  console.log(
    '| player | gap | rise | stops | spared | wars | wars more than the gap after a stop |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const player of Object.keys(PLAYERS) as Player[]) {
    const mine = games.filter((g) => g.player === player);
    for (const gap of gaps.split(',').map(Number))
      for (const rise of rises.split(',').map(Number)) {
        const played = mine.map((g) => replay(g, gap, rise));
        const stops = played.reduce((n, g) => n + g.stops.length, 0);
        const spared = played.reduce((n, g) => n + g.warnings.filter((w) => !w.stopped).length, 0);
        const wars = played.flatMap(warsAfterStops);
        console.log(
          `| ${player} | ${gap} | ${rise} | ${stops} | ${spared} | ${wars.length} | ${wars.filter((w) => w.sinceStop === null || w.sinceStop > gap).length} |`,
        );
      }
  }
} else if (values.summarize) {
  const games = positionals
    .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Game)
    .sort((a, b) => a.seed - b.seed);
  print(games);
  if (values.trail) trail(games);
} else {
  const players = values.players.split(',') as Player[];
  for (const player of players)
    if (!Object.hasOwn(PLAYERS, player))
      throw new Error(`--players takes ${Object.keys(PLAYERS).join(', ')}`);
  const games: Game[] = [];
  for (const player of players)
    for (
      let seed = Number(values.from);
      seed < Number(values.from) + Number(values.seeds);
      seed++
    ) {
      const game = play(player, seed, Number(values.years));
      games.push(game);
      if (values.json) console.log(JSON.stringify(game));
    }
  if (!values.json) print(games);
}
