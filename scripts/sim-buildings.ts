import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildingWorth, construction, PROJECT_PAYBACK_YEARS } from '../src/sim/ai/build.ts';
import { playCautiousRome } from './cautious-rome.ts';
import { recruitment } from '../src/sim/ai/budget.ts';
import { homeCapital, menUnderArms } from '../src/sim/ai/situation.ts';
import {
  FIRST_LEVELS,
  BUILDINGS,
  GREAT_WORKS,
  hasBuilt,
  SECOND_LEVELS,
  SIGNATURE_BUILDINGS,
  type BuildingKind,
  type FirstLevel,
} from '../src/sim/buildings/buildings.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { buildingGain } from '../src/sim/buildings/gains.ts';
import type { DeepReadonly } from '../src/sim/deep-readonly.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS, type PowerId } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { City } from '../src/sim/state/city.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import { warKey } from '../src/sim/state/war.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/** The value, or a thrown error naming what the test expected to exist. */
function need<T>(value: T | undefined, what = 'a record'): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/**
 * Prints the building table, what each building pays back in a sample of cities, and
 * four Romes at peace for 5 and 10 years: one that does nothing, one that only recruits
 * by the AI's rule, one that only builds by the AI's rule, and one that does both, as
 * the AI does. Every other faction gives no orders, so no war interrupts the sums.
 */

const { values } = parseArgs({ options: { seed: { type: 'string', default: '1' } } });
const SEED = Number(values.seed);
const rome = 'rome' as FactionId;
const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const table = (header: readonly string[], rows: readonly (readonly string[])[]) => {
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
  console.log('');
};

const start = newGame(map, { seed: SEED, player: 'rome' });
const capital = homeCapital(start, world, rome);
if (!capital) throw new Error('rome has no capital');

console.log('## The buildings\n');
table(
  ['building', 'gold', 'days', 'needs people', 'does'],
  FIRST_LEVELS.map((kind) => {
    const { name, gold, days, needs } = BUILDINGS[kind];
    const { daily, levy, walls, garrison, trainingShare, calmed } = buildingGain(
      start,
      capital,
      kind,
    );
    const does = [
      daily.gold && `${signed(daily.gold)} gold/day`,
      daily.food && `${signed(daily.food)} food/day`,
      daily.manpower && `${signed(daily.manpower)} manpower/day`,
      levy && `+${whole(levy)} levy`,
      trainingShare < 1 && `trains in ${trainingShare * 100}% of the days`,
      walls && `+${whole(walls)} walls`,
      garrison && `+${whole(garrison)} garrison`,
      kind === 'temple' &&
        `unrest ×${BUILDINGS.temple.unrestPace} in ${calmed.length} cities within ${BUILDINGS.temple.reachKm} km`,
    ].filter(Boolean);
    return [name, whole(gold), String(days), whole(needs.people), `${does.join(', ')} (at Roma)`];
  }),
);

/**
 * A sample of cities, each given to Rome as it stands on day 1: Rome's own four, and
 * minor cities of each kind near and far, so the table shows where each building suits.
 */
function sampleCities(): { label: string; state: DeepReadonly<GameState>; city: City }[] {
  const own = Object.values(start.cities)
    .filter((city) => city.owner === rome)
    .sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1));
  const minors = Object.values(start.cities)
    .filter((city) => start.factions[city.owner]?.kind === 'minor')
    .map((city) => ({
      city,
      km: Math.hypot(
        city.position.x - need(capital).position.x,
        city.position.y - need(capital).position.y,
      ),
    }))
    .sort((a, b) => a.km - b.km);
  const picks = [
    ...own.map((city) => ({ label: `${city.name} (Rome, ${city.rank})`, city })),
    ...[minors[0], minors[Math.floor(minors.length / 2)], minors.at(-1)].flatMap((pick) =>
      pick
        ? [
            {
              label: `${pick.city.name} (minor, ${whole(pick.city.population)} people, ${whole(pick.km)} km)`,
              city: pick.city,
            },
          ]
        : [],
    ),
  ];
  const samples: { label: string; state: DeepReadonly<GameState>; city: City }[] = picks.map(
    ({ label, city }) => {
      const given = { ...city, owner: rome, unrestDays: 0 };
      return {
        label,
        state: { ...start, cities: { ...start.cities, [city.id]: given } },
        city: given,
      };
    },
  );
  const front = own
    .flatMap((city) =>
      minors.map(({ city: minor }) => ({
        city,
        minor,
        km: Math.hypot(city.position.x - minor.position.x, city.position.y - minor.position.y),
      })),
    )
    .sort((a, b) => a.km - b.km)[0];
  if (front) {
    samples.push({
      label: `${front.city.name} at war with ${front.minor.name}, ${whole(front.km)} km away`,
      state: {
        ...start,
        wars: { ...start.wars, [warKey(rome, front.minor.owner)]: { since: start.day } },
      },
      city: front.city,
    });
  }
  return samples;
}

console.log('## Years each building takes to pay back its gold, by the AI valuation\n');
console.log(
  'Food counts at the gold the same people yield instead, and manpower likewise. Towers count the upkeep of the field men their garrison spares, on a border only. A temple counts the output it saves in one conquest a year of a city like the nearest foreign one in its reach. A dash is a building the city cannot start or that pays nothing there.\n',
);
const firsts = new Set<BuildingKind>();
const suits = new Map<BuildingKind, number>();
table(
  ['city', ...FIRST_LEVELS.map((kind) => BUILDINGS[kind].name), 'first choice'],
  sampleCities().map(({ label, state, city }) => {
    const years = FIRST_LEVELS.map((kind) => {
      if (city.population < BUILDINGS[kind].needs.people) return undefined;
      const worth = buildingWorth(state, city, kind);
      return worth > 0 ? BUILDINGS[kind].gold / worth / 365 : undefined;
    });
    let first: FirstLevel | undefined;
    years.forEach((y, i) => {
      const kind = need(FIRST_LEVELS[i]);
      if (y === undefined) return;
      suits.set(kind, Math.min(suits.get(kind) ?? Infinity, y));
      if (!first || y < (years[FIRST_LEVELS.indexOf(first)] ?? Infinity)) first = kind;
    });
    if (first) firsts.add(first);
    return [
      label,
      ...years.map((y) => (y === undefined ? '-' : y.toFixed(1))),
      first ? BUILDINGS[first].name : '-',
    ];
  }),
);
console.log(
  `In the city it suits best: ${FIRST_LEVELS.map((kind) => `${BUILDINGS[kind].name} ${suits.get(kind)?.toFixed(1) ?? '-'} years`).join(', ')}.`,
);
console.log(
  `Target 2 to 6 years: ${
    FIRST_LEVELS.every((kind) => {
      const y = suits.get(kind);
      return y !== undefined && y >= 2 && y <= 6;
    })
      ? 'met'
      : 'not met'
  }. First choices differ by city: ${firsts.size > 1 ? 'met' : 'not met'} (${[...firsts].map((k) => BUILDINGS[k].name).join(', ')}).\n`,
);

type Ruler = 'nothing' | 'recruits' | 'builds' | 'both';
const RULERS: readonly Ruler[] = ['nothing', 'recruits', 'builds', 'both'];

function ordersOf(state: DeepReadonly<GameState>, ruler: Ruler): Order[] {
  const recruits =
    ruler === 'recruits' || ruler === 'both' ? recruitment(state, rome, capitalOf(state)) : [];
  const builds =
    ruler === 'builds' || ruler === 'both'
      ? construction(state, rome, recruits.length > 0, ruler === 'both')
      : [];
  return [...recruits, ...builds];
}

function capitalOf(state: DeepReadonly<GameState>) {
  return state.cities[need(capital).id as CityId];
}

/** The ruler's state with gold it cannot run out of, to ask what it would buy. */
function rich(state: DeepReadonly<GameState>): DeepReadonly<GameState> {
  const faction = need(state.factions[rome]);
  return {
    ...state,
    factions: {
      ...state.factions,
      [rome]: { ...faction, stores: { ...faction.stores, gold: 1e9 } },
    },
  };
}

console.log('## Rome at peace\n');
console.log(
  '"Short of gold" counts the days on which the ruler wanted to recruit or build and lacked the gold for it. "At the treasury limit" counts the days its gold stood at `TREASURY_DAYS` of its people\'s pay.\n',
);
const rows: string[][] = [];
interface Outcome {
  short: number;
  atLimit: number;
  firstAtLimit: number | undefined;
  lastBuilt: number;
  goldIncome: number;
  men: number;
}
const outcomes = new Map<Ruler, Outcome>();
let fedYearFive: DeepReadonly<GameState> = start;
for (const ruler of RULERS) {
  let state: DeepReadonly<GameState> = start;
  let short = 0;
  let atLimit = 0;
  let firstAtLimit: number | undefined;
  let lastBuilt = 0;
  for (let day = 1; day <= 10 * 365; day++) {
    const orders = ordersOf(state, ruler);
    if (day <= 5 * 365 && ruler !== 'nothing') {
      const wanted = ordersOf(rich(state), ruler);
      if (wanted.length > orders.length) short += 1;
    }
    const gold = need(state.factions[rome]).stores.gold;
    if (day <= 5 * 365 && gold >= (limitsOf(state).get(rome)?.gold ?? Infinity) - 1) {
      atLimit += 1;
      firstAtLimit ??= day;
    }
    if (orders.some((order) => order.kind === 'build')) lastBuilt = day;
    state = tick(state as GameState, orders, world).state;
    if (ruler === 'both' && day === 5 * 365) fedYearFive = state;
    if (day === 5 * 365 || day === 10 * 365) {
      const stores = need(state.factions[rome]).stores;
      const balance = need(dailyBalances(state).get(rome));
      const built = Object.values(state.cities)
        .filter((city) => city.owner === rome)
        .reduce((n, city) => n + city.buildings.length, 0);
      rows.push([
        ruler,
        `year ${day / 365}`,
        whole(stores.gold),
        whole(stores.food),
        whole(stores.manpower),
        `${signed(balance.gold)} / ${signed(balance.food)} / ${signed(balance.manpower)}`,
        whole(menUnderArms(state, rome)),
        String(built),
        day === 5 * 365 ? `${short} of ${5 * 365}` : '',
        day === 5 * 365 ? String(atLimit) : '',
      ]);
    }
    if (day === 10 * 365) {
      outcomes.set(ruler, {
        short,
        atLimit,
        firstAtLimit,
        lastBuilt,
        goldIncome: need(dailyBalances(state).get(rome)).gold,
        men: menUnderArms(state, rome),
      });
    }
  }
}
table(
  [
    'ruler',
    'when',
    'gold',
    'food',
    'manpower',
    'income a day (gold / food / manpower)',
    'men',
    'buildings',
    'days short of gold, years 1-5',
    'days at the treasury limit, years 1-5',
  ],
  rows,
);

const of = (ruler: Ruler) => need(outcomes.get(ruler), `the outcome of the ruler who ${ruler}`);
const mark = (ok: boolean) => (ok ? 'met' : 'NOT met');
const both = of('both');
const builds = of('builds');
const recruits = of('recruits');
const nothing = of('nothing');
console.log('Targets:\n');
console.log(
  `- Building pays: the Rome that builds earns more gold a day at year 10 than the one that does nothing (${signed(builds.goldIncome)} against ${signed(nothing.goldIncome)}): ${mark(builds.goldIncome > nothing.goldIncome)}.`,
);
console.log(
  `- Building leaves recruiting worth it: the Rome that does both keeps at least the men of the one that only recruits (${whole(both.men)} against ${whole(recruits.men)}): ${mark(both.men >= recruits.men)}.`,
);
console.log(
  `- The Rome that builds and recruits is short of gold more days than not in years 1-5 (${both.short} of ${5 * 365}): ${mark(both.short > (5 * 365) / 2)}.`,
);
console.log(
  `- The Rome that builds and recruits never reaches the treasury limit in years 1-5 (${both.atLimit} days): ${mark(both.atLimit === 0)}.`,
);
const idleAfter = builds.firstAtLimit === undefined || builds.firstAtLimit > builds.lastBuilt;
console.log(
  `- The Rome that only builds reaches the treasury limit only once it has nothing left worth building (first at the limit on day ${builds.firstAtLimit ?? '-'}, last building ordered on day ${builds.lastBuilt}): ${mark(idleAfter)}.`,
);
console.log(
  `- The Rome that only recruits reaches the treasury limit on ${recruits.atLimit} days in years 1-5, as on main, because food and the levy cap its army before its gold. This is outside the buildings and belongs to the balance of recruiting.`,
);

console.log('\n## Years each second level and great work takes to pay back its gold\n');
console.log(
  "By the same valuation, in each city with every first level it may build already standing: Rome's cities and the city at war on day 1, and Rome's cities in year 4 of a peaceful game on this seed under the AI, when Roma trades, and in year 5 of the Rome below that builds and recruits, whose men eat its harvest. Where each suits is read on day 1, as for the first levels, and for the Merchants' quarter and Reservoirs in the later years, as no city trades and no harvest is tight on day 1. A dash pays nothing there.\n",
);
const PROJECTS: readonly BuildingKind[] = [
  ...FIRST_LEVELS.map((kind) => SECOND_LEVELS[kind]),
  ...GREAT_WORKS,
];
/** The city with every first level it has the people for, in a state where it holds them. */
function withFirsts(state: DeepReadonly<GameState>, city: DeepReadonly<City>) {
  const buildings = FIRST_LEVELS.filter((kind) => city.population >= BUILDINGS[kind].needs.people);
  const given = { ...city, buildings, construction: null };
  return { state: { ...state, cities: { ...state.cities, [city.id]: given } }, city: given };
}
const yearFour = playCautiousRome(SEED, 4, () => {}, { peaceful: true, answer: true });
const projectSamples = [
  ...sampleCities()
    .filter(({ label }) => label.includes('(Rome') || label.includes('at war'))
    .map(({ label, state, city }) => ({
      label: `${label}, day 1`,
      day1: true,
      ...withFirsts(state, city),
    })),
  ...Object.values(yearFour.cities)
    .filter((city) => city.owner === rome)
    .map((city) => ({ label: `${city.name}, year 4`, day1: false, ...withFirsts(yearFour, city) })),
  ...Object.values(fedYearFive.cities)
    .filter((city) => city.owner === rome)
    .map((city) => ({
      label: `${city.name}, year 5 of the Rome that builds and recruits`,
      day1: false,
      ...withFirsts(fedYearFive, city),
    })),
];
/**
 * Where each suits is read on day 1, as the first levels' table is, except the Merchants'
 * quarter, which needs the routes a city opens only later, and Reservoirs, which need a
 * harvest the realm's men eat, as canals once built leave none to spare on day 1.
 */
const readsLate = (kind: BuildingKind) => kind === 'merchantsQuarter' || kind === 'reservoirs';
const projectSuits = new Map<BuildingKind, number>();
const projectWorst = new Map<BuildingKind, number>();
table(
  ['city', ...PROJECTS.map((kind) => BUILDINGS[kind].name)],
  projectSamples.map(({ label, state, city, day1 }) => [
    label,
    ...PROJECTS.map((kind) => {
      const worth = buildingWorth(state, city, kind);
      const years = worth > 0 ? BUILDINGS[kind].gold / worth / 365 : Infinity;
      if (day1 !== readsLate(kind))
        projectSuits.set(kind, Math.min(projectSuits.get(kind) ?? Infinity, years));
      projectWorst.set(kind, Math.max(projectWorst.get(kind) ?? 0, years));
      return Number.isFinite(years) ? years.toFixed(1) : '-';
    }),
  ]),
);
const yearsText = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? 'never' : `${n.toFixed(1)} years`;
console.log(
  `In the city each suits best (day 1; Merchants' quarter and Reservoirs later): ${PROJECTS.map((kind) => `${BUILDINGS[kind].name} ${yearsText(projectSuits.get(kind))}`).join(', ')}.`,
);
const seconds = FIRST_LEVELS.map((kind) => SECOND_LEVELS[kind]);
console.log(
  `Target, a second level about 5 years (4.5 to 5.5) where it suits: ${
    seconds.every((kind) => {
      const y = projectSuits.get(kind) ?? Infinity;
      return y >= 4.5 && y <= 5.5;
    })
      ? 'met'
      : 'not met'
  }. A great work 4 to 5 years where it suits: ${
    GREAT_WORKS.every((kind) => {
      const y = projectSuits.get(kind) ?? Infinity;
      return y >= 4 && y <= 5;
    })
      ? 'met'
      : 'not met'
  }. Each great work past PROJECT_PAYBACK_YEARS (${PROJECT_PAYBACK_YEARS}) somewhere, the wrong choice there: ${
    GREAT_WORKS.every((kind) => (projectWorst.get(kind) ?? 0) > PROJECT_PAYBACK_YEARS)
      ? 'met'
      : 'not met'
  } (${GREAT_WORKS.map((kind) => `${BUILDINGS[kind].name} ${yearsText(projectWorst.get(kind))}`).join(', ')}).\n`,
);

console.log("## Each great power's own building\n");
console.log(
  "Years each pays back its gold by the AI valuation, in its power's homeland cities on day 1 and in year 4 of a game every power plays by the AI. A Colonia counts the unrest it spares in one conquest a year within its reach, a Cothon and a Royal road the upkeep of the realm's armies for the days they save on two crossings a year, and Royal stables that of three formations of heavy cavalry for the days of training saved. The last column counts the cities that hold it at the end of year 10 of that game.\n",
);
let played: GameState = newGame(map, { seed: SEED, player: 'rome' });
const playTo = (year: number) => {
  while (played.day <= year * 365) played = tick(played, decideAll(played, world, []), world).state;
  return played;
};
const atYearFour = playTo(4);
const atYearTen = playTo(10);
const ownPaybacks = (state: DeepReadonly<GameState>, power: PowerId) => {
  const kind = SIGNATURE_BUILDINGS[power];
  const years = Object.values(state.cities)
    .filter((city) => (city.owner as string) === power && !hasBuilt(city, kind))
    .map((city) => {
      const worth = buildingWorth(state, { ...city, unrestDays: 0 }, kind);
      return worth > 0 ? BUILDINGS[kind].gold / worth / 365 : Infinity;
    });
  return years.length === 0 ? undefined : Math.min(...years);
};
table(
  ['power', 'building', 'gold', 'days', 'best on day 1', 'best in year 4', 'built by year 10'],
  POWERS.map((power) => {
    const kind = SIGNATURE_BUILDINGS[power];
    const day1 = newGame(map, { seed: SEED, player: power });
    const built = Object.values(atYearTen.cities).filter((city) => hasBuilt(city, kind)).length;
    return [
      power,
      BUILDINGS[kind].name,
      whole(BUILDINGS[kind].gold),
      String(BUILDINGS[kind].days),
      yearsText(ownPaybacks(day1, power)),
      yearsText(ownPaybacks(atYearFour, power)),
      String(built),
    ];
  }),
);
