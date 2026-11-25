import { expect, test, type Page } from '@playwright/test';
import { ADVANCES } from '../src/sim/advances/advances.ts';
import { limitsOf } from '../src/sim/systems/economy.ts';
import type { FactionId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { HINT_SHARE } from '../src/app/advance-news.ts';
import {
  day,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  romaTreasuryFull,
  startGame,
  untilDay,
  untilDrawn,
} from './support.ts';
import { discoveryGame, loadDiscovery } from './guide-game.ts';

const rome = 'rome' as FactionId;

function romeOf(state: GameState) {
  const record = state.factions[rome];
  if (!record) throw new Error('no Rome');
  return record;
}

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

test.describe('advances', () => {
  test('the top bar says nothing is studied, and the panel starts the advance chosen', async ({
    page,
  }) => {
    await openGame(page);
    await load(page, romaTreasuryFull());
    const button = page.getByTestId('advances-button');
    await expect(page.getByTestId('study-line')).toHaveText('None studied');

    await button.click();
    const panel = page.getByTestId('advances');
    await expect(panel.getByTestId('advances-now')).toContainText('Nothing is being studied.');
    // The open panel's button is drawn dark, so its note takes the button's own light colour.
    const ink = await button.evaluate((element) => getComputedStyle(element).color);
    await expect(page.getByTestId('study-line')).toHaveCSS('color', ink);
    for (const branch of ['military', 'economy', 'statecraft'])
      await expect(panel.getByTestId(`branch-${branch}`).getByRole('listitem')).toHaveCount(3);
    const clemency = panel.getByTestId('advance-clemency');
    await expect(clemency).toContainText(`${ADVANCES.clemency.gold.toLocaleString('en-GB')} gold`);
    await expect(clemency).toContainText(`${ADVANCES.clemency.days} days`);

    await panel.getByTestId('study-clemency').click();
    await expect(clemency).toContainText('Ordered for the next day');
    await expect(panel.getByTestId('study-standardCoin')).toBeDisabled();

    const from = await day(page);
    await resume(page);
    await untilDay(page, from + 1);
    await pause(page);
    await expect(clemency).toContainText('Studying');
    await expect(page.getByTestId('study-line')).toHaveText(new RegExp(`^Clemency · \\d+ days$`));
    await expect(panel.getByTestId('advances-now')).toContainText(
      /Studying Clemency: \d+ days left/,
    );
  });

  test('a save with an advance one day from done loads with it, and its end stops the game with a line that opens the panel', async ({
    page,
  }) => {
    await openGame(page, { pauses: true });
    const state = startGame();
    romeOf(state).advances = ['standardCoin'];
    romeOf(state).study = { advance: 'marchingRations', daysLeft: 1, paid: 3000 };
    await load(page, state);
    await expect(page.getByTestId('study-line')).toHaveText('Marching rations · 1 day');
    await page.getByTestId('advances-button').click();
    const panel = page.getByTestId('advances');
    await expect(panel.getByTestId('advance-standardCoin')).toContainText('Studied');
    await expect(panel.getByTestId('advance-marchingRations')).toContainText('Studying');
    await expect(panel.getByTestId('advances-cancel')).toHaveText(
      `Give up (${(ADVANCES.marchingRations.gold / 2).toLocaleString('en-GB')} gold back)`,
    );
    await page.getByTestId('advances-button').click();

    await resume(page);
    const line = page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ has: page.getByTestId('alert-paused') })
      .filter({
        hasText:
          'Marching rations is studied, for good. Nothing is being studied now: choose the next advance in the Advances panel.',
      });
    await expect(line).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(page.getByTestId('study-line')).toHaveText('None studied');
    await line.getByRole('button').first().click();
    await expect(page.getByTestId('advances')).toBeVisible();
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(page.getByTestId('chronicle')).toContainText(
      'Marching rations is studied, for good.',
    );
  });

  test('with its switch off in the Game menu, an advance that finishes does not stop the game', async ({
    page,
  }) => {
    await openGame(page, { pauses: true });
    await page.getByRole('button', { name: 'Game' }).click();
    const box = page.getByTestId('pause-advance');
    await expect(box).toBeChecked();
    await box.uncheck();
    await page.getByRole('button', { name: 'Game' }).click();
    const state = startGame();
    romeOf(state).study = { advance: 'marchingRations', daysLeft: 1, paid: 3000 };
    await load(page, state);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      'Marching rations is studied, for good.',
    );
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await untilDay(page, state.day + 3);
    await pause(page);
  });

  test('the panel names the advance it marks at its top, and Show it brings that card into view', async ({
    page,
  }) => {
    await openGame(page);
    const state = startGame();
    romeOf(state).stores.gold = 15_000;
    for (const city of Object.values(state.cities))
      if (city.owner === rome) city.construction = { building: 'temple', daysLeft: 300 };
    await load(page, state);
    await page.getByTestId('advances-button').click();
    const panel = page.getByTestId('advances');
    const line = panel.getByTestId('advances-marked');
    await expect(line).toContainText(/^Pays back soonest of what you can start: (.+), in/);
    const name = (await line.textContent())?.match(/start: (.+?), in/)?.[1] ?? '';
    const card = panel.locator('li').filter({ has: page.getByTestId('advance-suggested') });
    await expect(card).toContainText(name);
    await expect(line).toBeInViewport();
    await panel.getByTestId('advances-show-marked').click();
    await expect(card).toBeInViewport({ ratio: 0.9 });
  });

  test('a realm that studies nothing is told once, as its treasury nears its limit, that the panel exists', async ({
    page,
  }) => {
    await openGame(page, { pauses: true });
    const state = startGame();
    const limit = limitsOf(state).get(rome)?.gold ?? 0;
    romeOf(state).stores.gold = HINT_SHARE * limit - 30;
    // Every city has a building at work, so the buildings' hint has none to name and this one is told at once.
    for (const city of Object.values(state.cities))
      if (city.owner === rome) city.construction = { building: 'temple', daysLeft: 300 };
    await load(page, state);
    await resume(page);
    const news = page.getByTestId('alerts');
    const hint = news.getByRole('button', { name: /nothing is being studied/ });
    await expect(hint).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await untilDay(page, (await day(page)) + 3);
    await pause(page);
    await expect(hint).toHaveCount(1);
    await hint.click();
    await expect(page.getByTestId('advances')).toBeVisible();
  });

  for (const width of [1280, 1024])
    test(`the top bar keeps one row at ${width}px while the longest advance is studied and a store is short`, async ({
      page,
    }) => {
      await openGame(page);
      await resizeTo(page, { width, height: 768 });
      const state = discoveryGame();
      romeOf(state).study = { advance: 'marchingRations', daysLeft: 240, paid: 3000 };
      romeOf(state).stores.food = -15_400;
      await loadDiscovery(page, state);
      const bar = page.getByTestId('top-bar');
      await expect(bar.getByTestId('store-food-note')).toHaveText('Short 15,400');
      await expect(bar.getByTestId(width >= 1280 ? 'study-line' : 'study-days')).toHaveText(
        width >= 1280 ? 'Marching rations · 240 days' : '240 days',
      );
      await expect(bar.getByTestId('advances-button')).toHaveAttribute(
        'title',
        'Studying Marching rations: 240 days left.',
      );
      const boxes = await bar
        .locator(':scope > *, .store, .end > *, [data-testid="time-controls"] > *')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
          }),
        );
      expect(Math.max(...boxes.map((b) => b.y))).toBeLessThan(
        Math.min(...boxes.map((b) => b.bottom)),
      );
      for (const box of boxes) expect(box.right).toBeLessThanOrEqual(width);
    });
});
