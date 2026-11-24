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

  test('a save with an advance at work loads with it, and its end is news that does not stop the game', async ({
    page,
  }) => {
    await openGame(page, { pauses: true });
    const state = startGame();
    romeOf(state).advances = ['standardCoin'];
    romeOf(state).study = { advance: 'marchingRations', daysLeft: 3, paid: 3000 };
    await load(page, state);
    await expect(page.getByTestId('study-line')).toHaveText('Marching rations · 3 days');
    await page.getByTestId('advances-button').click();
    const panel = page.getByTestId('advances');
    await expect(panel.getByTestId('advance-standardCoin')).toContainText('Studied');
    await expect(panel.getByTestId('advance-marchingRations')).toContainText('Studying');
    await expect(panel.getByTestId('advances-cancel')).toHaveText(
      `Give up (${(ADVANCES.marchingRations.gold / 2).toLocaleString('en-GB')} gold back)`,
    );

    await resume(page);
    const news = page.getByTestId('alerts');
    await expect(news).toContainText('Marching rations is studied, for good.');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await untilDay(page, state.day + 5);
    await pause(page);
    await expect(page.getByTestId('study-line')).toHaveText('None studied');
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(page.getByTestId('chronicle')).toContainText(
      'Marching rations is studied, for good.',
    );
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
