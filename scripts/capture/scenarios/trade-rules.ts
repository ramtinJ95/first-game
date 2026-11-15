import { expect } from '@playwright/test';
import {
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'trade-rules',
  title: 'Trade goods, city slots, and the price and income forecast before opening a route',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = startGame();
    const rome = state.factions[state.player];
    if (!rome) throw new Error('missing Rome');
    rome.stores.gold = 5000;
    await dropSave(page, state);
    await untilDrawn(page);
    const roma = cityPoint('roma');
    const point = camera(page).screen({ x: roma.x, y: roma.y + 40 });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    await page
      .getByTestId('trade-partners')
      .getByRole('button', { name: /^Carthago by sea/ })
      .click();
    await page.getByTestId('trade-forecast').scrollIntoViewIfNeeded();
    await shot(
      'trade-forecast',
      'Roma and Carthago: unlike goods, sea distance, payment to each end, opening price, payback, and Carthage’s consent',
    );
    await page
      .getByRole('button', { name: 'Open trade route to Carthago by sea', exact: true })
      .click();
    await expect(page.getByTestId('store-gold-amount')).toHaveText('5,000');
    await page.getByTestId('trade-routes').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('trade-payment-timing')).toBeInViewport();
    await shot(
      'trade-ordered',
      'The queued opening order reserves a route slot at both ends; the treasury still holds 5,000 gold while paused, and the panel says opening gold is paid when the clock runs',
    );
  },
});
