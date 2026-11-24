import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { threatNewsOfDay } from '../../src/app/threat-news.ts';
import { dateText } from '../../src/app/names.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf, menOf, UPKEEP_PER_MAN } from '../../src/sim/systems/economy.ts';
import { TROOPS } from '../../src/sim/troops.ts';
import { recruitForecast } from '../../src/ui/recruit-forecast.ts';
import { GREAT_WORKS, SECOND_LEVELS } from '../../src/sim/buildings/buildings.ts';
import { panelBuilds, playCautiousRome, rome, warnedPowers, world } from '../cautious-rome.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    players: { type: 'string', default: 'cautious,ignoring,answering' },
    json: { type: 'boolean', default: false },
    summarize: { type: 'boolean', default: false },
    label: { type: 'string', default: 'the game as it is' },
  },
});

/**
 * The repository's test players: `cautious` is `playCautiousRome` as trade-judge plays it,
 * `ignoring` declares no war and does nothing about a warning, and `answering` declares no
 * war and answers each warning as it advises: the troop it names, as `threat-runup --answer`
 * plays it, and guards at the city it names until the power no longer stands on notice there.
 * `raising` is the answering Rome before it hired guards: the troop alone. Each of these builds
 * by the AI's rule. The `panel-` Romes build as the city panel suggests (`panelBuilds`), the
 * `first-` Romes by the AI's rule but first levels only, so their gold sits at its limit as the
 * game before city projects left it, and the `hoarding-` Romes build nothing, as the thirteenth
 * play-through's tester did, each ignoring or answering as above.
 */
const FIRST_ONLY = { forbid: [...Object.values(SECOND_LEVELS), ...GREAT_WORKS] };
const NOTHING = { builds: () => [] };
const PLAYERS = {
  cautious: {},
  ignoring: { peaceful: true },
  answering: { peaceful: true, answer: true, guards: 'enough' },
  raising: { peaceful: true, answer: true },
  'panel-ignoring': { peaceful: true, builds: panelBuilds },
  'panel-answering': { peaceful: true, answer: true, guards: 'enough', builds: panelBuilds },
  'first-ignoring': { peaceful: true, ...FIRST_ONLY },
  'first-answering': { peaceful: true, answer: true, guards: 'enough', ...FIRST_ONLY },
  'first-raising': { peaceful: true, answer: true, ...FIRST_ONLY },
  'hoarding-ignoring': { peaceful: true, ...NOTHING },
  'hoarding-answering': { peaceful: true, answer: true, guards: 'enough', ...NOTHING },
} as const;
type Player = keyof typeof PLAYERS;

/** The troop the warnings name when nothing else is affordable: the cheapest in gold. */
const CHEAPEST = 'skirmishers';
const { men: CHEAPEST_MEN, gold: CHEAPEST_GOLD } = TROOPS[CHEAPEST].recruit;
/** The first day after the early and middle game the play-throughs call fun: Year 6, day 1. */
const MIDDLE_ENDS = 5 * 365 + 1;
const STORES = ['manpower', 'food', 'gold'] as const;
type Store = (typeof STORES)[number];

/** Rome on the last day of one year of the game. */
interface Year {
  foodDay: number;
  food: number;
  foodLimit: number;
  manpower: number;
  manpowerLimit: number;
  gold: number;
  goldLimit: number;
  goldCapDays: number;
  /** Days of the year with the food store below zero, when cities shrink and men desert. */
  hungryDays: number;
  men: number;
  /** Men under arms of the great power that fields the most, Rome aside. */
  rivalMen: number;
  people: number;
  cities: number;
  canals: number;
  barracks: number;
  /** Days of the year on which the cheapest troop could not be raised for want of each store. */
  shortDays: Record<Store, number>;
  /** Warnings of the year, and those that came with too little manpower for the cheapest troop. */
  warnings?: number;
  warnedShort?: number;
}

interface Game {
  player: Player;
  seed: number;
  fellOn: number | null;
  years: Year[];
  /** The first day the cheapest troop could not be raised for want of each store. */
  firstShort: Record<Store, number | null>;
  citiesLost: number;
  wars: number;
  /** The days each war on Rome by a great power was declared and each of Rome's cities fell. */
  warDays: number[];
  lossDays: number[];
  warnings: number;
  stops: number;
}

function romeNow(state: GameState) {
  const cities = Object.values(state.cities).filter((c) => c.owner === rome);
  const men = new Map<FactionId, number>();
  for (const army of Object.values(state.armies))
    men.set(army.owner, (men.get(army.owner) ?? 0) + menOf(state, army));
  const rivals = Object.values(state.factions).filter(
    (f) => f.kind === 'greatPower' && f.id !== rome && f.defeatedOn === null,
  );
  return {
    cities: cities.length,
    canals: cities.filter((c) => c.buildings.includes('canals')).length,
    barracks: cities.filter((c) => c.buildings.includes('barracks')).length,
    men: men.get(rome as FactionId) ?? 0,
    rivalMen: Math.max(0, ...rivals.map((f) => men.get(f.id) ?? 0)),
    people: cities.reduce((sum, c) => sum + c.population, 0),
    stores: state.factions[rome]?.stores ?? { gold: 0, food: 0, manpower: 0 },
    limits: limitsOf(state).get(rome as FactionId) ?? { gold: 0, food: 0, manpower: 0 },
    balance: dailyBalances(state).get(rome as FactionId) ?? { gold: 0, food: 0, manpower: 0 },
  };
}

/** Whether the recruit card, asked about the cheapest troop today, says each store falls short. */
function shortOf(state: GameState, foodAfterRaise: number): Record<Store, boolean> {
  const stores = state.factions[rome]?.stores;
  if (!stores || state.factions[rome]?.defeatedOn !== null)
    return { manpower: true, food: true, gold: true };
  return {
    manpower: stores.manpower < CHEAPEST_MEN,
    gold: stores.gold < CHEAPEST_GOLD,
    // A balance that still grows after every recruit's upkeep never runs short, so the card need not be asked.
    food:
      foodAfterRaise < 0 && recruitForecast(state, [], world, CHEAPEST).short.food !== undefined,
  };
}

const emptyYear = (): Year => ({
  foodDay: 0,
  food: 0,
  foodLimit: 0,
  manpower: 0,
  manpowerLimit: 0,
  gold: 0,
  goldLimit: 0,
  goldCapDays: 0,
  hungryDays: 0,
  men: 0,
  rivalMen: 0,
  people: 0,
  canals: 0,
  barracks: 0,
  cities: 0,
  shortDays: { manpower: 0, food: 0, gold: 0 },
});

function play(player: Player, seed: number, years: number): Game {
  const game: Game = {
    player,
    seed,
    fellOn: null,
    years: Array.from({ length: years }, emptyYear),
    firstShort: { manpower: null, food: null, gold: null },
    citiesLost: 0,
    wars: 0,
    warDays: [],
    lossDays: [],
    warnings: 0,
    stops: 0,
  };
  const told = new Set<string>();
  const end = playCautiousRome(
    seed,
    years,
    ({ before, after, events }) => {
      const day = before.day;
      const year = game.years[Math.floor((day - 1) / 365)];
      if (!year) return;
      for (const alert of threatNewsOfDay(before, after, world, told)) {
        if (alert.pause) game.stops++;
        const named = warnedPowers(alert.text).length;
        game.warnings += named;
        year.warnings = (year.warnings ?? 0) + named;
        if ((after.factions[rome]?.stores.manpower ?? 0) < CHEAPEST_MEN)
          year.warnedShort = (year.warnedShort ?? 0) + named;
      }
      for (const event of events)
        if (
          event.kind === 'warDeclared' &&
          event.against === rome &&
          after.factions[event.by]?.kind === 'greatPower'
        ) {
          game.wars++;
          game.warDays.push(day);
        }
      for (const city of Object.values(before.cities))
        if (city.owner === rome && after.cities[city.id]?.owner !== rome) {
          game.citiesLost++;
          game.lossDays.push(day);
        }
      const now = romeNow(after);
      // The economy caps gold before the people grow, so the day's cap is the limit of the morning's people.
      const cap = limitsOf(before).get(rome as FactionId)?.gold ?? Infinity;
      if (now.stores.gold >= cap - 1) year.goldCapDays++;
      if (now.stores.food < 0) year.hungryDays++;
      const training = Object.values(after.cities)
        .filter((c) => c.owner === rome)
        .flatMap((c) => c.recruits)
        .reduce((sum, r) => sum + TROOPS[r.troop].recruit.men, CHEAPEST_MEN);
      const short = shortOf(after, now.balance.food - training * UPKEEP_PER_MAN.food);
      for (const store of STORES)
        if (short[store]) {
          year.shortDays[store]++;
          game.firstShort[store] ??= after.day;
        }
      if ((after.day - 1) % 365 === 0)
        Object.assign(year, {
          foodDay: now.balance.food,
          food: now.stores.food,
          foodLimit: now.limits.food,
          manpower: now.stores.manpower,
          manpowerLimit: now.limits.manpower,
          gold: now.stores.gold,
          goldLimit: now.limits.gold,
          men: now.men,
          rivalMen: now.rivalMen,
          canals: now.canals,
          barracks: now.barracks,
          people: now.people,
          cities: now.cities,
        });
    },
    PLAYERS[player],
  );
  game.fellOn = end.factions[rome]?.defeatedOn ?? null;
  return game;
}

const yearDay = (day: number | null) => (day === null ? 'never' : dateText(day));
const at = (sorted: readonly number[], share: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
const spread = (all: readonly number[], digits = 0) => {
  const sorted = [...all].sort((a, b) => a - b);
  const f = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });
  return `${f(at(sorted, 0.5))} (${f(at(sorted, 0.1))}–${f(at(sorted, 0.9))})`;
};
const median = (all: readonly number[]) =>
  at(
    [...all].sort((a, b) => a - b),
    0.5,
  );

function print(games: readonly Game[]) {
  console.log(
    `${values.label}: medians over seeds, with the 10th to 90th percentile in brackets. A fallen Rome counts as 0 cities, 0 men and empty stores. "Short" counts the days the cheapest troop (${CHEAPEST}, ${CHEAPEST_MEN} men, ${CHEAPEST_GOLD} gold) could not be raised: manpower below ${CHEAPEST_MEN}, gold below ${CHEAPEST_GOLD}, or the recruit card warning of a food shortfall.`,
  );
  for (const player of Object.keys(PLAYERS) as Player[]) {
    const mine = games.filter((g) => g.player === player);
    if (mine.length === 0) continue;
    console.log(`\n### ${player}, ${mine.length} seeds\n`);
    console.log(
      '| year | cities | people | men under arms | largest rival’s men | canals / barracks | food a day | food stored / limit | days food below 0 | manpower / limit | gold / limit | days gold at limit | days short of manpower | of food | of gold | warnings, with too few men for the cheapest troop |',
    );
    console.log(
      '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    const years = Math.max(...mine.map((g) => g.years.length));
    for (let y = 0; y < years; y++) {
      const rows = mine.map((g) => g.years[y] ?? emptyYear());
      const of = (f: (r: Year) => number, digits = 0) => spread(rows.map(f), digits);
      console.log(
        `| ${y + 1} | ${of((r) => r.cities)} | ${of((r) => r.people)} | ${of((r) => r.men)} | ${of((r) => r.rivalMen)} | ${of((r) => r.canals)} / ${of((r) => r.barracks)} | ${of((r) => r.foodDay, 1)} | ${of((r) => r.food)} / ${of((r) => r.foodLimit)} | ${of((r) => r.hungryDays)} | ${of((r) => r.manpower)} / ${of((r) => r.manpowerLimit)} | ${of((r) => r.gold)} / ${of((r) => r.goldLimit)} | ${of((r) => r.goldCapDays)} | ${of((r) => r.shortDays.manpower)} | ${of((r) => r.shortDays.food)} | ${of((r) => r.shortDays.gold)} | ${rows.reduce((n, r) => n + (r.warnings ?? 0), 0)}, ${rows.reduce((n, r) => n + (r.warnedShort ?? 0), 0)} |`,
      );
    }
    const firsts = STORES.map((store) => {
      const days = mine.map((g) => g.firstShort[store] ?? Infinity);
      const never = days.filter((d) => !Number.isFinite(d)).length;
      return `${store} ${yearDay(Number.isFinite(median(days)) ? median(days) : null)} (never in ${never})`;
    });
    console.log(`\nFirst day short of the cheapest troop, median: ${firsts.join(', ')}.`);
    const sum = (f: (g: Game) => number) => mine.reduce((total, g) => total + f(g), 0);
    const early = (days: readonly number[] | undefined) =>
      (days ?? []).filter((d) => d < MIDDLE_ENDS).length;
    const late = (days: readonly number[] | undefined) =>
      (days ?? []).filter((d) => d >= MIDDLE_ENDS).length;
    console.log(
      `By period: wars on Rome in years 1–5 ${sum((g) => early(g.warDays))}, in years 6–10 ${sum((g) => late(g.warDays))}; cities lost in years 1–5 ${sum((g) => early(g.lossDays))}, in years 6–10 ${sum((g) => late(g.lossDays))}.`,
    );
    console.log(
      `Summary: | ${values.label} | ${player} | cities lost ${sum((g) => g.citiesLost)} (median ${median(mine.map((g) => g.citiesLost))}) | falls ${mine.filter((g) => g.fellOn !== null).length} | wars on Rome ${sum((g) => g.wars)} | warnings a game ${(sum((g) => g.warnings) / mine.length).toFixed(1)} | stops a game ${(sum((g) => g.stops) / mine.length).toFixed(1)} | cities at end ${spread(mine.map((g) => g.years.at(-1)?.cities ?? 0))} | men at end ${spread(mine.map((g) => g.years.at(-1)?.men ?? 0))} | gold at end ${spread(mine.map((g) => g.years.at(-1)?.gold ?? 0))} |`,
    );
  }
}

if (values.summarize) {
  print(
    positionals
      .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Game)
      .sort((a, b) => a.seed - b.seed),
  );
} else {
  const players = values.players.split(',') as Player[];
  for (const player of players)
    if (!Object.hasOwn(PLAYERS, player))
      throw new Error(`--players takes ${Object.keys(PLAYERS).join(', ')}`);
  const first = Number(values.from);
  const games: Game[] = [];
  for (const player of players)
    for (let seed = first; seed < first + Number(values.seeds); seed++) {
      const game = play(player, seed, Number(values.years));
      games.push(game);
      if (values.json) console.log(JSON.stringify(game));
    }
  if (!values.json) print(games);
}
