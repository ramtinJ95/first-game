import { expect, type Page } from '@playwright/test';
import {
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  rome,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import { HINT_SHARE } from '../../../src/app/advance-news.ts';
import { changeCityOwner } from '../../../src/sim/cities.ts';
import { limitsOf } from '../../../src/sim/systems/economy.ts';
import type { CityId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const NARROW = { width: 1024, height: 720 };
const PHONE = { width: 390, height: 844 };

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

async function resize(page: Page, size: { width: number; height: number }) {
  await resizeTo(page, size);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
}

/** Rome on day 1 with a full purse, Standard coin studied and Fallow fields at work. */
function studying(daysLeft: number): GameState {
  const state = startGame();
  const realm = state.factions[rome];
  if (!realm) throw new Error('no Rome');
  realm.stores.gold = 15_000;
  realm.advances = ['standardCoin'];
  realm.study = { advance: 'fallowFields', daysLeft, paid: 6000 };
  return state;
}

/** Rome on day 1 with the eight cities nearest Roma besides its own, twelve in all, and nothing studied. */
function largeRealm(): GameState {
  const state = startGame();
  const roma = state.cities['roma' as CityId];
  const realm = state.factions[rome];
  if (!roma || !realm) throw new Error('no Roma');
  realm.stores.gold = 15_000;
  const km = (c: { position: { x: number; y: number } }) =>
    Math.hypot(c.position.x - roma.position.x, c.position.y - roma.position.y);
  const nearest = Object.values(state.cities)
    .filter((c) => c.owner !== rome)
    .sort((a, b) => km(a) - km(b))
    .slice(0, 8);
  for (const city of nearest) {
    changeCityOwner(state, city.id, rome);
    city.unrestDays = 0;
  }
  return state;
}

/** Rome on day 1 with a full purse and nothing studied. */
function fresh(): GameState {
  const state = startGame();
  const realm = state.factions[rome];
  if (!realm) throw new Error('no Rome');
  realm.stores.gold = 15_000;
  return state;
}

/** Rome just short of the treasury share that brings the hint, every city building, so the buildings' hint has none to name. */
function hinted(): GameState {
  const state = startGame();
  const realm = state.factions[rome];
  if (!realm) throw new Error('no Rome');
  realm.stores.gold = HINT_SHARE * (limitsOf(state).get(rome)?.gold ?? 0) - 30;
  for (const city of Object.values(state.cities))
    if (city.owner === rome) city.construction = { building: 'temple', daysLeft: 300 };
  return state;
}

export default defineScenario({
  name: 'advances',
  title:
    "The Advances panel's three branches with what each advance would do for Rome today, the line that names a building paying back sooner, the top bar's line of what is studied, the hint, and the news of an advance finished",
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await load(page, studying(120));
    await expect(page.getByTestId('study-line')).toHaveText('Fallow fields · 120 days');
    await shot(
      'top-bar-1280',
      'The top bar names the advance studied and its days left, at 1280 by 720',
    );

    await resize(page, NARROW);
    await expect(page.getByTestId('study-days')).toHaveText('120 days');
    await shot('top-bar-1024', 'At 1024 by 720 the top bar names only the days left');
    await resize(page, WIDE);

    await page.getByTestId('advances-button').click();
    const panel = page.getByTestId('advances');
    await expect(panel.getByTestId('advance-suggested')).toHaveCount(0);
    await expect(panel.getByTestId('advance-standardCoin')).toContainText('Studied');
    await shot(
      'panel-1280',
      'The Advances panel at 1280 by 720: Fallow fields at work, Standard coin studied, and for each other advance what it does, what it would do for Rome today, its price, its days and its payback',
    );
    await panel.getByTestId('branch-statecraft').scrollIntoViewIfNeeded();
    await shot('panel-statecraft-1280', 'The statecraft branch, scrolled to, at 1280 by 720');

    await resize(page, PHONE);
    await expect(page.getByTestId('study-days')).toHaveText('120 days');
    await shot(
      'panel-390',
      'The Advances panel at 390 px wide, with the top bar naming the days left',
    );
    await resize(page, WIDE);
    await page.getByTestId('advances-button').click();

    await load(page, largeRealm());
    await page.getByTestId('advances-button').click();
    await expect(page.getByTestId('advance-standardCoin-price')).toContainText(
      'your 12 cities pay',
    );
    await page.getByTestId('branch-economy').scrollIntoViewIfNeeded();
    await shot(
      'large-realm-1280',
      "The Advances panel for a Rome of 12 cities at 1280 by 720, scrolled to Economy: the advances that pay every city cost 12 eighths of their listed price, and each says why, and the top bar's None studied reads on the open panel's button",
    );
    await resize(page, PHONE);
    await page.getByTestId('advance-standardCoin-price').scrollIntoViewIfNeeded();
    await shot('large-realm-390', 'The same panel for a Rome of 12 cities at 390 px wide');
    await resize(page, WIDE);
    await page.getByTestId('advances-button').click();

    await load(page, fresh());
    await page.getByTestId('advances-button').click();
    await expect(page.getByTestId('advances-building-first')).toContainText(
      'sooner than any advance you can start',
    );
    await expect(page.getByTestId('advance-suggested')).toHaveCount(0);
    await shot(
      'building-first-1280',
      'Rome on day 1 with nothing studied: the panel names the building that would pay back sooner than any advance, and marks no advance',
    );
    await resize(page, PHONE);
    await shot('building-first-390', 'The same line at 390 px wide');
    await resize(page, WIDE);
    await page.getByTestId('advances-button').click();

    await load(page, hinted());
    await resume(page);
    const hint = page
      .getByTestId('alerts')
      .getByRole('button', { name: /nothing is being studied/ });
    await expect(hint).toHaveCount(1);
    await pause(page);
    await shot(
      'hint-1280',
      'The hint, told once as the treasury nears its limit while nothing has been studied, that the Advances panel exists',
    );
    await resize(page, PHONE);
    await shot('hint-390', 'The same hint at 390 px wide');
    await resize(page, WIDE);

    await load(page, studying(2));
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Fallow fields is studied, for good.');
    await pause(page);
    await expect(page.getByTestId('study-line')).toHaveText('None studied');
    await shot(
      'finished-1280',
      'The news of Fallow fields finished, in the corner, with the game still running until paused, and the top bar saying nothing is studied',
    );
    await resize(page, PHONE);
    await shot('finished-390', 'The same news at 390 px wide, the top bar saying None');
  },
});
