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
import { carthageHeldByLepcis } from '../../../e2e/held-war-game.ts';
import { warReadiness } from '../../../src/sim/ai/war.ts';
import { GUARD_BAND, GUARD_DAYS, GUARD_DETER_DAYS } from '../../../src/sim/guards.ts';
import { buildWorld } from '../../../src/sim/world/world.ts';
import { map } from '../../../e2e/support.ts';
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

/** Rome with Marching rations one day from done and nothing else to study after it. */
function advanceDoneTomorrow(): GameState {
  const state = startGame();
  const realm = state.factions[rome];
  if (!realm) throw new Error('no Rome');
  realm.study = { advance: 'marchingRations', daysLeft: 1, paid: 3000 };
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

/**
 * The longest stops of all: Carthage of 6,000 held back by its war with Lepcis Magna
 * (`carthageHeldByLepcis`), with two bands at Roma that stop counting on day 101, so the day's
 * stop tells the lapsed guards, the treasury, the food and the war that holds it back.
 * - `climb`: on notice since day 60, its last stop on day 70 8 points below its share without the guards.
 * - `reminder`: on notice since day 10 and warned on day 17, so the day's stop is its reminder.
 * - `first`: on notice since day 93 and never warned, so the day's stop is its first warning.
 */
function heldStop(play: 'climb' | 'reminder' | 'first'): {
  state: GameState;
  told: readonly string[];
} {
  const { state } = fromSave(carthageHeldByLepcis('warning'));
  const punic = state.factions[carthage];
  const spearmen = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roma = state.cities['roma' as CityId];
  if (!punic || !spearmen || !roma) throw new Error('no Carthage or Roma');
  punic.noticeSince = (play === 'climb' ? 60 : play === 'reminder' ? 10 : 93) as Day;
  spearmen.men = 6000;
  const bare = structuredClone(state);
  roma.guards = [0, 1].map(() => ({ until: (101 - GUARD_DETER_DAYS + GUARD_DAYS) as Day }));
  roma.garrison += 2 * GUARD_BAND;
  const share = Math.round(
    Math.min(1, warReadiness(bare, buildWorld(map), carthage, rome)?.readiness ?? 0) * 100,
  );
  const told =
    play === 'climb'
      ? ['threat:carthage:70', `threat-stop:carthage:70:${share - 8}:roma`]
      : play === 'reminder'
        ? ['threat:carthage:17', 'threat-stop:carthage:17:80:roma']
        : [];
  return { state, told };
}

/**
 * Guards at Roma that stop counting on day 111, which Carthage, on notice since day 60, counts:
 * ten days before, it would stand near 95% without them, free to declare, so the line stops the game.
 */
const ahead = fromSave(carthageClimbs(0, 2, [], 111));

/**
 * Eight years, to Year 9: a power then needs 12% less against a Rome still in its first cities,
 * two figures as at the most, 15%, while the year keeps the one figure the cases had.
 */
const LATER = 8 * 365;

/** Every day of the save's game and of what its page was told, eight years on, so its stop also says what Rome's staying home takes off. */
function eightYearsOn(save: { state: GameState; told?: readonly string[] }): {
  state: GameState;
  told: readonly string[];
} {
  const days = new Set([
    'day',
    'readyOn',
    'until',
    'hiredOn',
    'fellOn',
    'sackedOn',
    'startedOn',
    'since',
    'offeredOn',
    'departsOn',
    'defeatedOn',
    'noticeSince',
    'madeOn',
    'endsOn',
    'openedOn',
    'on',
    'stanceChangedOn',
  ]);
  const shift = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(shift);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        days.has(key) && typeof field === 'number' ? field + LATER : shift(field),
      ]),
    );
  };
  const told = (save.told ?? []).map((key) => {
    const parts = key.split(':');
    const at = parts[0] === 'guards-soon' ? 3 : 2;
    if (parts[at] !== undefined && /^\d+$/.test(parts[at]))
      parts[at] = String(Number(parts[at]) + LATER);
    return parts.join(':');
  });
  return { state: shift(save.state) as GameState, told };
}

/**
 * The save with Carthage's men cut by the 12% Rome's staying home takes off what it needs, so
 * it stands where it stood eight years before and its war with Lepcis Magna still holds it below 100%.
 */
function fewerMen(save: { state: GameState; told: readonly string[] }) {
  const spearmen = save.state.formations[armyOf(save.state, carthage).formations[0] as FormationId];
  if (!spearmen) throw new Error('no Carthaginian army');
  spearmen.men = Math.round(spearmen.men * 0.88);
  return save;
}

/** The longest stops, eight years on: each also says a power needs 12% less, since Rome has not grown, but the one that names a war leaves it to the At peace notes. */
const LATE = [
  {
    name: 'the longest warning',
    save: () => eightYearsOn(longest),
    line: /no longer count\. Carthage has climbed.*It needs 12% less: you have not grown\./,
    shot: 'staying-home-longest',
  },
  ...(['climb', 'reminder', 'first'] as const).map((play) => ({
    name: `the longest held ${play}`,
    save: () => fewerMen(eightYearsOn(heldStop(play))),
    line: /no longer count\..*food feeds no more men\. Once its war with Lepcis Magna ends, it would stand at/,
    shot: undefined,
  })),
  {
    name: 'guards that stop counting in ten days',
    save: () => eightYearsOn(ahead),
    line: /in 10 days, on .*and may declare\. It needs 12% less: you have not grown\. A new band/,
    shot: 'staying-home-ahead',
  },
];

/** The news of each kind that stops the game, with its longest text the saves give. */
const STOPS: readonly {
  name: string;
  make: () => GameState;
  line: RegExp;
  shot?: string;
  /** What the page was told before the save, when not nothing. */
  told?: readonly string[];
  /** Stop on it at these widths only, and shoot the At peace list in the wars panel as well. */
  atPeaceAt?: readonly number[];
  /** What Carthage's At peace line then says. */
  atPeace?: string;
  /** A note the At peace list then holds under the rows. */
  atPeaceNote?: string;
  /** The most lines its text may take in the corner, so a player who read it once can skim it after. */
  lines?: number;
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
    line: /still stands near war, as warned on .*may declare any day now.*Skirmishers need 500 men/,
    shot: 'reminder',
    told: ['threat:carthage:306'],
    atPeaceAt: [1280],
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
    line: /still stands near war, as warned on .*Heavy cavalry in training muster on Year 2, day 55, too late\. It weighs/,
    shot: 'training-reminder',
    told: ['threat:carthage:306'],
  },
  {
    name: 'a reminder by a city',
    make: carthageStillNearCity,
    line: /still stands near war, as warned on .*may declare any day now.*[Gg]uards at/,
    shot: 'city-reminder',
    told: ['threat:carthage:306'],
  },
  {
    name: 'a first warning too late for any troop to train',
    make: carthagePressesSoon,
    line: /could soon declare war on you.*Skirmishers ordered now muster on Year 1, day 111/,
    shot: 'late-warning',
    atPeaceAt: [1280],
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
    line: /no longer count\. Carthage has climbed.*Guards at Roma for 90 days lower it and eat nothing; food feeds no more men/,
    shot: 'longest-warning',
    lines: 13,
  },
  ...(['climb', 'reminder', 'first'] as const).map((play) => ({
    name: `the longest ${play === 'climb' ? 'climb' : play === 'reminder' ? 'reminder' : 'first warning'}, with lapsed guards, the treasury, the food and a war that holds the power back`,
    make: () => structuredClone(heldStop(play).state),
    told: heldStop(play).told,
    line: new RegExp(
      `no longer count\\. Carthage ${play === 'climb' ? 'has climbed' : play === 'reminder' ? 'still stands near war' : 'could soon declare war'}.*eat nothing; food feeds no more men\\. Once its war with Lepcis Magna ends, it would stand at`,
    ),
    shot: play === 'climb' ? 'longest-held-warning' : `longest-held-${play}`,
    lines: 13,
  })),
  {
    name: 'guards that stop counting in ten days, which would leave the power free to declare',
    make: () => structuredClone(ahead.state),
    told: ahead.told,
    line: /stop counting against Carthage's war in 10 days, on .*and may declare\. A new band counts 90 days, for 2,000 gold\./,
    shot: 'guards-ahead-stop',
    lines: 13,
  },
  ...LATE.map((late) => ({
    name: `${late.name}, eight years on, which also says what Rome's staying home takes off`,
    make: () => late.save().state,
    told: late.save().told,
    line: late.line,
    ...(late.shot ? { shot: late.shot } : {}),
    lines: 13,
  })),
  {
    name: 'a warning by a city, eight years on',
    make: () => eightYearsOn({ state: carthageNearsWar() }).state,
    line: /could soon declare war on you.*It needs 12% less: you have not grown\. See At peace/,
    shot: 'staying-home-warning',
    atPeaceAt: [1280, 1024],
    atPeace: 'Carthage has',
    atPeaceNote:
      'You hold no more cities than at the start, so Carthage needs 12% less of the strength to declare war on you: 1.5% for each year of the game, to at most 15%. Holding more cities than at the start ends it.',
  },
  { name: 'a city in danger', make: alone(ownCityInDangerTomorrow), line: /is in danger/ },
  { name: 'fleets sighted', make: alone(fiveFleetsOnRoma), line: /sail|march/ },
  { name: 'a weak siege', make: alone(weakSiegeOfMediolanum), line: /Too few|too weak/ },
  { name: 'a battle', make: alone(battleTomorrow), line: /Battle at Roma/ },
  {
    name: 'an advance finished with nothing else studied',
    make: alone(advanceDoneTomorrow),
    line: /Nothing is being studied now: choose the next advance/,
    shot: 'advance-finished',
  },
];

async function stopOn(
  page: Page,
  state: GameState,
  line: RegExp,
  told?: readonly string[],
  lines?: number,
) {
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
  if (lines === undefined) return;
  const read = await item.locator('.text').evaluate((text) => {
    const range = document.createRange();
    // The words alone, since the Paused badge beside them sits on another baseline.
    range.selectNodeContents(text.lastChild ?? text);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(read, `the stopped line takes ${lines} lines or fewer`).toBeLessThanOrEqual(lines);
}

export default defineScenario({
  name: 'paused-news-fits',
  title:
    'News that stops the game is read whole in the corner at 1280 × 720 and 1024 × 720: the war warnings and a reminder, a city in danger, fleets sighted, a weak siege, a battle, and an advance finished with nothing else studied',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 720 });
      for (const stop of STOPS) {
        if (stop.atPeaceAt && !stop.atPeaceAt.includes(width)) continue;
        await stopOn(page, stop.make(), stop.line, stop.told, stop.lines);
        if (stop.shot)
          await shot(
            `${stop.shot}-${width}`,
            `${width} × 720: ${stop.name} stops the game and is read to its last word`,
          );
        if (stop.atPeaceAt?.includes(width)) {
          await page.getByTestId('wars-button').click();
          await expect(
            page
              .getByTestId('wars-panel')
              .getByTestId('threat-row')
              .filter({ hasText: stop.atPeace ?? '' }),
          ).toHaveCount(1);
          if (stop.atPeaceNote) {
            const note = page
              .getByTestId('wars-panel')
              .getByTestId('threat-note')
              .filter({ hasText: stop.atPeaceNote });
            await expect(note).toHaveCount(1);
            await note.scrollIntoViewIfNeeded();
          }
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
