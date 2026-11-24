import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { threatNewsOfDay } from '../../src/app/threat-news.ts';
import { warReadiness } from '../../src/sim/ai/war.ts';
import { strengthNear, strengthOf } from '../../src/sim/ai/situation.ts';
import { NOTICE_DAYS, WAR_FRONT_KM } from '../../src/sim/ai/thresholds.ts';
import { guardRefusal, weighedGarrison } from '../../src/sim/guards.ts';
import type { CityId, FactionId } from '../../src/sim/ids.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { playCautiousRome, rome, warnedPowers, world } from '../cautious-rome.ts';

const { values, positionals } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    players: { type: 'string', default: 'ignoring,answering' },
    summarize: { type: 'boolean', default: false },
    label: { type: 'string', default: 'the game as it is' },
  },
  allowPositionals: true,
});

/** The Romes of `npm run sim -- slide`, which this audit plays war by war. */
const PLAYERS = {
  ignoring: { peaceful: true },
  answering: { peaceful: true, answer: true, guards: 'enough' },
  raising: { peaceful: true, answer: true },
} as const;
type Player = keyof typeof PLAYERS;

interface Stand {
  power: string;
  from: number;
  to: number;
  /** The highest readiness the power reached on the stand, and on the first day it might declare. */
  peak: number;
  atDay30: number | null;
  warned: boolean;
  war: boolean;
}

interface WarRecord {
  power: string;
  day: number;
  readiness: number;
  front: string;
  /** Rome's strength the power weighed at the front, and the power's and Rome's whole field strength. */
  weighed: number;
  powerField: number;
  romeField: number;
  warnedOn: number | null;
  /** Rome's weighed strength at the front on the warning's day, before its answer. */
  weighedAtWarning: number | null;
  readinessAtWarning: number | null;
  lost: string[];
  endedOn: number | null;
}

/** Every city of the faction, with the strength a power weighs there. */
function weighedAt(state: GameState, city: CityId): number {
  const at = state.cities[city];
  if (!at) return 0;
  const armies = Object.values(state.armies).filter((a) => a.owner === at.owner);
  return strengthNear(state, armies, at.position, WAR_FRONT_KM) + weighedGarrison(at, state.day);
}

function fieldOf(state: GameState, faction: string): number {
  return Object.values(state.armies)
    .filter((a) => a.owner === faction)
    .reduce((sum, a) => sum + strengthOf(state, a), 0);
}

function play(player: Player, seed: number, years: number) {
  const told = new Set<string>();
  const stands: Stand[] = [];
  const open = new Map<string, Stand>();
  const wars: WarRecord[] = [];
  const losses: { day: number; city: string; to: string }[] = [];
  const warnings: {
    day: number;
    powers: string[];
    city: string | null;
    readiness: number[];
    guards: number;
    recruits: number;
    manpower: number;
    gold: number;
    bands: number;
    refusal: string | null;
  }[] = [];
  const lastWarning = new Map<string, { day: number; weighed: number; readiness: number }>();
  const end = playCautiousRome(
    seed,
    years,
    ({ before, after, events, accepted }) => {
      const last = warnings.at(-1);
      if (last && after.day - last.day <= 2)
        for (const order of accepted) {
          if (order.kind === 'hireGuards') last.guards++;
          if (order.kind === 'recruit') last.recruits++;
        }
      for (const power of Object.values(after.factions)) {
        if (power.kind !== 'greatPower' || power.id === rome) continue;
        const stand = open.get(power.id);
        if (power.noticeSince !== null) {
          const readiness = warReadiness(after, world, power.id, rome)?.readiness ?? 0;
          const s = stand ?? {
            power: power.id,
            from: power.noticeSince,
            to: after.day,
            peak: 0,
            atDay30: null,
            warned: false,
            war: false,
          };
          s.to = after.day;
          s.peak = Math.max(s.peak, readiness);
          if (after.day - power.noticeSince === NOTICE_DAYS) s.atDay30 = readiness;
          open.set(power.id, s);
        } else if (stand) {
          stand.war = areAtWar(after, power.id, rome);
          stands.push(stand);
          open.delete(power.id);
        }
      }
      for (const alert of threatNewsOfDay(before, after, world, told)) {
        const at = alert.focus?.at;
        const city = Object.values(after.cities).find(
          (c) => at && c.position.x === at.x && c.position.y === at.y,
        );
        const names = warnedPowers(alert.text);
        const powers = Object.values(after.factions)
          .filter((f) => names.some((n) => f.name.startsWith(n) || n.startsWith(f.name)))
          .map((f) => f.id as string);
        const readiness = powers.map(
          (p) => warReadiness(after, world, p as FactionId, rome)?.readiness ?? 0,
        );
        warnings.push({
          day: after.day,
          powers,
          city: city?.id ?? null,
          readiness,
          guards: 0,
          recruits: 0,
          manpower: after.factions[rome]?.stores.manpower ?? 0,
          gold: after.factions[rome]?.stores.gold ?? 0,
          bands: city?.guards.length ?? 0,
          refusal: city ? (guardRefusal(after, city, rome) ?? null) : null,
        });
        powers.forEach((p, i) => {
          const stand = open.get(p);
          if (stand) stand.warned = true;
          const threat = warReadiness(after, world, p as FactionId, rome);
          lastWarning.set(p, {
            day: after.day,
            weighed: threat ? weighedAt(after, threat.front) : 0,
            readiness: readiness[i] ?? 0,
          });
        });
      }
      for (const event of events) {
        if (
          event.kind === 'warDeclared' &&
          event.against === rome &&
          after.factions[event.by]?.kind === 'greatPower'
        ) {
          const threat = warReadiness(before, world, event.by, rome);
          const warning = lastWarning.get(event.by);
          wars.push({
            power: event.by,
            day: after.day,
            readiness: threat?.readiness ?? 0,
            front: threat?.front ?? '',
            weighed: threat ? weighedAt(before, threat.front) : 0,
            powerField: fieldOf(before, event.by),
            romeField: fieldOf(before, rome),
            warnedOn: warning?.day ?? null,
            weighedAtWarning: warning?.weighed ?? null,
            readinessAtWarning: warning?.readiness ?? null,
            lost: [],
            endedOn: null,
          });
        }
        if (event.kind === 'peaceMade' && event.between.includes(rome)) {
          const other = event.between.find((f) => f !== rome);
          const war = wars.findLast((w) => w.power === other && w.endedOn === null);
          if (war) war.endedOn = after.day;
        }
      }
      for (const city of Object.values(before.cities))
        if (city.owner === rome && after.cities[city.id]?.owner !== rome) {
          const to = after.cities[city.id]?.owner ?? '';
          losses.push({ day: after.day, city: city.id, to });
          // A city ceded in the peace changes hands on the day its war ends.
          wars
            .findLast((w) => w.power === to && (w.endedOn === null || w.endedOn === after.day))
            ?.lost.push(city.id);
        }
    },
    PLAYERS[player],
  );
  stands.push(...open.values());
  return {
    player,
    seed,
    fellOn: end.factions[rome]?.defeatedOn ?? null,
    cities: Object.values(end.cities).filter((c) => c.owner === rome).length,
    stands,
    warnings,
    wars,
    losses,
  };
}

type Game = ReturnType<typeof play>;

const year = (day: number) => Math.floor((day - 1) / 365) + 1;
const fixed = (n: number | null) => (n === null ? '–' : n.toFixed(2));

/** Whether the war began while Rome fought another great power that had declared on it before. */
const pileOn = (game: Game, war: WarRecord) =>
  game.wars.some(
    (other) =>
      other !== war &&
      game.wars.indexOf(other) < game.wars.indexOf(war) &&
      (other.endedOn === null || other.endedOn >= war.day),
  );

function summarize(games: readonly Game[]) {
  console.log(`${values.label}.`);
  console.log(
    '\n| Rome | seeds | warnings | stands of 7 days | of 30 days | of 30 that reach 1 | wars on Rome | of them on a Rome at war | cities lost | lost a war | falls | seeds holding its 4 cities |',
  );
  console.log(
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const player of Object.keys(PLAYERS) as Player[]) {
    const mine = games.filter((g) => g.player === player);
    if (mine.length === 0) continue;
    const stands = mine.flatMap((g) => g.stands);
    const long = stands.filter((s) => s.to - s.from >= NOTICE_DAYS);
    const wars = mine.flatMap((g) => g.wars);
    const lost = mine.reduce((sum, g) => sum + g.losses.length, 0);
    const piled = mine.reduce((sum, g) => sum + g.wars.filter((w) => pileOn(g, w)).length, 0);
    console.log(
      `| ${player} | ${mine.length} | ${mine.reduce((sum, g) => sum + g.warnings.length, 0)} | ${stands.filter((s) => s.to - s.from >= 7).length} | ${long.length} | ${long.filter((s) => s.peak >= 1).length} | ${wars.length} | ${piled} | ${lost} | ${(lost / Math.max(1, wars.length)).toFixed(1)} | ${mine.filter((g) => g.fellOn !== null).length} | ${mine.filter((g) => g.losses.length === 0).length} |`,
    );
  }
  for (const player of Object.keys(PLAYERS) as Player[]) {
    const mine = games.filter((g) => g.player === player && g.wars.length > 0);
    if (mine.length === 0) continue;
    console.log(`\n### Each war on the ${player} Rome\n`);
    console.log(
      '| seed | power | warned | readiness then | answer: troops / bands of guards | guards refused because | declared | readiness then | Rome weighed at the front, warned / declared | on a Rome at war | cities lost | peace |',
    );
    console.log('| ---: | --- | --- | ---: | --- | --- | --- | ---: | --- | --- | --- | --- |');
    for (const game of mine)
      for (const war of game.wars) {
        const warning = game.warnings.findLast(
          (w) => w.day <= war.day && w.powers.includes(war.power),
        );
        console.log(
          `| ${game.seed} | ${war.power} | ${warning ? `Y${year(warning.day)} d${warning.day}` : '–'} | ${fixed(war.readinessAtWarning)} | ${warning ? `${warning.recruits} / ${warning.guards}` : '–'} | ${warning?.refusal ?? ''} | Y${year(war.day)} d${war.day} | ${fixed(war.readiness)} | ${Math.round(war.weighedAtWarning ?? 0)} / ${Math.round(war.weighed)} | ${pileOn(game, war) ? 'yes' : ''} | ${war.lost.join(', ')} | ${war.endedOn === null ? 'none' : `d${war.endedOn}`} |`,
        );
      }
  }
}

if (values.summarize) {
  summarize(
    positionals
      .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Game)
      .sort((a, b) => a.seed - b.seed),
  );
} else {
  const first = Number(values.from);
  for (const player of values.players.split(',') as Player[])
    for (let seed = first; seed < first + Number(values.seeds); seed++)
      console.log(JSON.stringify(play(player, seed, Number(values.years))));
}
