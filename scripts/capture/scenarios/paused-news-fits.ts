import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  dropSave,
  fiveFleetsOnRoma,
  openGame,
  outnumberedAt,
  pause,
  resizeTo,
  resume,
  rome,
  startGame,
  untilDrawn,
  weakSiegeOfMediolanum,
} from '../../../e2e/support.ts';
import { ownCityInDangerTomorrow } from '../../../e2e/warnings-game.ts';
import { carthageClimbs } from '../../../e2e/climb-game.ts';
import { loadGame } from '../../../src/sim/save.ts';
import type { CityId, FactionId, FormationId } from '../../../src/sim/ids.ts';

const macedon = 'macedon' as FactionId;
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { warKey } from '../../../src/sim/state/war.ts';
import { areAtWar } from '../../../src/sim/wars.ts';
import { defineScenario } from '../scenario.ts';
import { pageData } from '../../../src/app/page.ts';
import { saveGame } from '../../../src/sim/save.ts';

/**
 * Rome with 1,000 men in the field beside a Carthage of 2,000: Carthage presses it by its field
 * armies, and Rome has the gold for Skirmishers but too little manpower, the advice's longest text.
 */
function carthagePresses(): GameState {
  const state = carthageNearsWar();
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  if (!punic || !roman) throw new Error('no armies');
  punic.men = 2000;
  roman.men = 1000;
  const stores = state.factions[rome]?.stores;
  if (!stores) throw new Error('no Roman stores');
  stores.gold = 2229;
  stores.manpower = 300;
  return state;
}

/** Carthage beside Rome as in `carthageNearsWar`, and Macedon with 30,000 men: both come on notice the same day. */
function carthageAndMacedonNearWar(): GameState {
  const state = carthageNearsWar();
  const macedonians = state.formations[armyOf(state, macedon).formations[0] as FormationId];
  if (!macedonians) throw new Error('no Macedonian army');
  macedonians.men = 30_000;
  return state;
}

/**
 * Carthage pressing Rome as in `carthagePresses` on day 400, on one notice since day 300 that it
 * warned of on day 306, naming day 330, so the day's warning is its reminder, its first day of
 * war has passed, so the advice is what Rome may raise, here what it lacks for Skirmishers.
 */
function carthageStillNearWar(): GameState {
  const state = carthagePresses();
  state.day = 400 as Day;
  for (const truce of Object.values(state.truces)) truce.endsOn = (400 + 365) as Day;
  const punic = state.factions[carthage];
  if (!punic) throw new Error('no Carthage');
  punic.noticeSince = 300 as Day;
  return state;
}

/**
 * Carthage pressing Rome as in `carthagePresses` on day 100, on notice since day 78 that the page
 * was never told of, as after a save is imported, so its first warning names day 108, before any
 * troop Rome can afford finishes training, and the advice names the day Skirmishers ordered now muster.
 */
function carthagePressesSoon(): GameState {
  const state = carthagePresses();
  state.day = 100 as Day;
  const punic = state.factions[carthage];
  const stores = state.factions[rome]?.stores;
  if (!punic || !stores) throw new Error('no Carthage or Roman stores');
  stores.manpower = 5000;
  punic.noticeSince = 78 as Day;
  return state;
}

/** Carthage by a city as in `carthageNearsWar`, held on the notice it warned of on day 306 to day 400: its reminder. */
function carthageStillNearCity(): GameState {
  const state = carthageNearsWar();
  state.day = 400 as Day;
  for (const truce of Object.values(state.truces)) truce.endsOn = (400 + 365) as Day;
  const punic = state.factions[carthage];
  if (!punic) throw new Error('no Carthage');
  punic.noticeSince = 300 as Day;
  return state;
}

/**
 * Carthage pressing Rome as in `carthagePresses`, with Heavy cavalry, the longest troop name, in
 * training at Roma for 20 days: the first warning's longest advice, the men in training and
 * whether they are enough.
 */
function carthagePressesTraining(): GameState {
  const state = carthagePresses();
  state.cities['roma' as CityId]?.recruits.push({
    troop: 'heavyCavalry',
    readyOn: (state.day + 20) as Day,
  });
  return state;
}

/** The reminder of `carthageStillNearWar`, with Heavy cavalry in training at Roma: the longest warning with men in training. */
function carthageStillNearWarTraining(): GameState {
  const state = carthageStillNearWar();
  state.cities['roma' as CityId]?.recruits.push({
    troop: 'heavyCavalry',
    readyOn: (state.day + 20) as Day,
  });
  return state;
}

function battleTomorrow(): GameState {
  const state = startGame();
  outnumberedAt(state, 'roma', 1500);
  return state;
}

/**
 * The save with every great power that is not at war with the player bound by a truce, so
 * the news that stops the game is the save's own and no war warning comes before it.
 */
function alone(make: () => GameState): () => GameState {
  return () => {
    const state = make();
    for (const power of Object.values(state.factions))
      if (
        power.kind === 'greatPower' &&
        power.id !== state.player &&
        !areAtWar(state, power.id, state.player)
      )
        state.truces[warKey(power.id, state.player)] = {
          since: state.day,
          endsOn: (state.day + 365) as Day,
        };
    return state;
  };
}

/**
 * Carthage pressing Rome as in `carthagePresses`, with Rome's cities grown no larger than 9,000
 * and 60 food in store, so its food feeds no more men: the warning says men raised would desert,
 * and names the Canals that would feed them.
 */
function carthagePressesHungry(): GameState {
  const state = carthagePresses();
  for (const city of Object.values(state.cities))
    if (city.owner === rome) city.population = Math.min(city.population, 9000);
  const stores = state.factions[rome]?.stores;
  if (!stores) throw new Error('no Roman stores');
  Object.assign(stores, { food: 60, gold: 5000, manpower: 5000 });
  return state;
}

/** A save's game and what its page was told. */
function fromSave(text: string): { state: GameState; told: readonly string[] } {
  const loaded = loadGame(text);
  if (!loaded.ok) throw new Error(loaded.error);
  const told = (loaded.page as { told?: readonly string[] } | undefined)?.told ?? [];
  return { state: loaded.state, told };
}

/**
 * The longest stopping warning the game tells, as `carthageClimbs` builds it for the
 * warning-climb capture: a climb told with guards that stop counting, the treasury, the food.
 */
const longest = fromSave(carthageClimbs(8, 2));

/** The news of each kind that stops the game, with its longest text the saves give. */
const STOPS: readonly {
  name: string;
  make: () => GameState;
  line: RegExp;
  shot?: string;
  /** What the page was told before the save, when not nothing. */
  told?: readonly string[];
  /** Stop on it at this width only, and shoot the At peace list in the wars panel as well. */
  atPeaceAt?: number;
  /** What Carthage's At peace line then says. */
  atPeace?: string;
}[] = [
  {
    name: 'a warning by a city',
    make: carthageNearsWar,
    line: /could soon declare war on you/,
    shot: 'warning',
  },
  {
    name: 'a warning by field armies',
    make: carthagePresses,
    line: /all your armies in the field.*Skirmishers need 500 men, 10 days; you have \d+ manpower/,
    shot: 'field-warning',
  },
  {
    name: 'a reminder whose first day of war has passed',
    make: carthageStillNearWar,
    line: /still stands near war with you, as warned on .*may declare any day now.*Skirmishers need 500 men/,
    shot: 'reminder',
    told: ['threat:carthage:306'],
    atPeaceAt: 1280,
    atPeace: 'It may declare any day now if it holds it.',
  },
  {
    name: 'a warning with men in training',
    make: carthagePressesTraining,
    line: /could soon declare war on you.*Heavy cavalry in training muster on Year 1, day 21, which is enough\. It weighs/,
    shot: 'training-warning',
  },
  {
    name: 'a reminder with men in training',
    make: carthageStillNearWarTraining,
    line: /still stands near war with you, as warned on .*Heavy cavalry in training muster on Year 2, day 55, too late\. It weighs/,
    shot: 'training-reminder',
    told: ['threat:carthage:306'],
  },
  {
    name: 'a reminder by a city',
    make: carthageStillNearCity,
    line: /still stands near war with you, as warned on .*may declare any day now.*[Gg]uards at/,
    shot: 'city-reminder',
    told: ['threat:carthage:306'],
  },
  {
    name: 'a first warning too late for any troop to train',
    make: carthagePressesSoon,
    line: /could soon declare war on you.*Skirmishers ordered now muster on Year 1, day 111/,
    shot: 'late-warning',
    atPeaceAt: 1280,
    atPeace: 'order Skirmishers now for 900 gold; they muster and lower it from Year 1, day 111',
  },
  {
    name: 'two warnings on one day',
    make: carthageAndMacedonNearWar,
    line: /^.*Carthage and Macedon could soon declare war on you/,
    shot: 'two-warnings',
  },
  {
    name: 'a warning by field armies to a realm whose food feeds no more men',
    make: carthagePressesHungry,
    line: /all your armies in the field.*Men raised now would desert: food feeds no more\. Canals at/,
    shot: 'hungry-warning',
  },
  {
    name: 'the longest warning, a climb told with guards that stop counting',
    make: () => structuredClone(longest.state),
    told: longest.told,
    line: /no longer count against Carthage's war\. Carthage stands higher.*Guards at Roma for 90 days lower it and eat nothing; your food feeds no more men/,
    shot: 'longest-warning',
  },
  { name: 'a city in danger', make: alone(ownCityInDangerTomorrow), line: /is in danger/ },
  { name: 'fleets sighted', make: alone(fiveFleetsOnRoma), line: /sail|march/ },
  { name: 'a weak siege', make: alone(weakSiegeOfMediolanum), line: /Too few|too weak/ },
  { name: 'a battle', make: alone(battleTomorrow), line: /Battle at Roma/ },
];

async function stopOn(page: Page, state: GameState, line: RegExp, told?: readonly string[]) {
  await pause(page);
  await dropSave(
    page,
    told
      ? saveGame(
          state,
          pageData({
            chronicle: [],
            camera: undefined,
            selection: undefined,
            panel: undefined,
            occupied: new Map(),
            told: new Set(told),
            weakSieges: new Map(),
          }),
        )
      : state,
  );
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await resume(page);
  const alerts = page.getByTestId('alerts');
  const item = alerts
    .getByRole('listitem')
    .filter({ has: page.getByTestId('alert-paused') })
    .filter({ hasText: line })
    .first();
  await item.waitFor();
  await untilDrawn(page);
  const box = await item.boundingBox();
  const list = await alerts.boundingBox();
  const window = page.viewportSize();
  if (!box || !list || !window) throw new Error('no alert, corner or window');
  expect(box.y, 'the stopped line starts inside the corner').toBeGreaterThanOrEqual(list.y - 0.5);
  expect(box.y + box.height, 'the stopped line ends inside the corner').toBeLessThanOrEqual(
    list.y + list.height + 0.5,
  );
  expect(box.y + box.height, 'the stopped line ends inside the window').toBeLessThanOrEqual(
    window.height,
  );
}

export default defineScenario({
  name: 'paused-news-fits',
  title:
    'News that stops the game is read whole in the corner at 1280 × 720 and 1024 × 720: the war warnings and a reminder, a city in danger, fleets sighted, a weak siege, and a battle',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 720 });
      for (const stop of STOPS) {
        if (stop.atPeaceAt !== undefined && stop.atPeaceAt !== width) continue;
        await stopOn(page, stop.make(), stop.line, stop.told);
        if (stop.shot)
          await shot(
            `${stop.shot}-${width}`,
            `${width} × 720: ${stop.name} stops the game and is read to its last word`,
          );
        if (stop.atPeaceAt === width) {
          await page.getByTestId('wars-button').click();
          await expect(
            page
              .getByTestId('wars-panel')
              .getByTestId('threat-row')
              .filter({ hasText: stop.atPeace ?? '' }),
          ).toHaveCount(1);
          await shot(
            `${stop.shot}-at-peace-${width}`,
            `${width} × 720: the At peace list after ${stop.name}`,
          );
          await page.getByTestId('wars-button').click();
        }
      }
    }
  },
});
