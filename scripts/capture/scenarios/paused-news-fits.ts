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
import type { FactionId, FormationId } from '../../../src/sim/ids.ts';

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
    line: /could soon declare war on you.*may declare any day now.*Skirmishers need 500 men/,
    shot: 'reminder',
    told: ['threat:carthage:306'],
    atPeaceAt: 1280,
  },
  {
    name: 'two warnings on one day',
    make: carthageAndMacedonNearWar,
    line: /^.*Carthage and Macedon could soon declare war on you/,
    shot: 'two-warnings',
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
              .filter({ hasText: 'It may declare any day now if it holds it.' }),
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
