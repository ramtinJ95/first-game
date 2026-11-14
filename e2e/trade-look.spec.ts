import { expect, test } from '@playwright/test';
import { routePoint } from '../src/sim/trade/routes.ts';
import { camera, openGame, pause, untilDrawn } from './support.ts';
import { loadSave } from './watch.ts';
import { raidedRome, tradeRoute, tradingRome } from './trade-game.ts';

test('a selected city traces trade, goods label the land, and drawn merchants survive loading', async ({
  page,
}) => {
  await openGame(page);
  await pause(page);
  const state = tradingRome();
  await loadSave(page, state);
  const view = camera(page);
  const roma = view.city('roma');
  await page.mouse.click(roma.x, roma.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
  await view.jumpTo(routePoint(tradeRoute(state, 'land')), 1.2);
  await untilDrawn(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-trade-paths', '2');
  await expect(canvas).toHaveAttribute('data-trade-caravans', /[1-9]/);
  await expect(canvas).toHaveAttribute('data-goods', /[1-9]/);
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(page.getByTestId('guide-trade')).toContainText('pay on arrival');
});

test('a trade ship is a drawn figure at the closest zoom, not a land caravan', async ({ page }) => {
  await openGame(page);
  await pause(page);
  const state = tradingRome();
  await loadSave(page, state);
  const view = camera(page);
  await view.jumpTo(routePoint(tradeRoute(state, 'sea')), 4);
  await untilDrawn(page);
  await expect(page.locator('canvas')).toHaveAttribute('data-trade-ships', /[1-9]/);
});

test('a loaded road raid is marked at its saved location', async ({ page }) => {
  await openGame(page);
  await pause(page);
  const state = raidedRome();
  await loadSave(page, state);
  const raid = tradeRoute(state, 'land').raid;
  if (!raid) throw new Error('missing raid');
  await camera(page).jumpTo(raid.position, 4);
  await untilDrawn(page);
  await expect(page.locator('canvas')).toHaveAttribute('data-raids', '1');
});
