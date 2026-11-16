import { expect, type Page } from '@playwright/test';
import { camera, cityPoint, openGame, pause, resume, untilDrawn } from '../../../e2e/support.ts';
import { loadSave, untilDay } from '../../../e2e/watch.ts';
import { romaTradesThreeWays, tradeRoute } from '../../../e2e/trade-game.ts';
import { routePoint } from '../../../src/sim/trade/routes.ts';
import { defineScenario } from '../scenario.ts';

async function settled(page: Page) {
  await page.locator('canvas[data-figure-sheets="ready"][data-terrain="ready"]').waitFor();
  await untilDrawn(page);
}

/** Plays on at the speed shown until the map draws merchants of this kind, then pauses. */
async function playUntilDrawn(page: Page, kind: 'caravans' | 'ships') {
  await resume(page);
  await page
    .locator(`canvas[data-trade-${kind}]:not([data-trade-${kind}="0"])`)
    .waitFor({ timeout: 120_000 });
  await pause(page);
  await settled(page);
  await expect(page.locator('canvas')).not.toHaveAttribute(`data-trade-${kind}`, '0');
}

export default defineScenario({
  name: 'merchants',
  clipSeconds: 60,
  title:
    'A game played on from Rome opening three routes from Roma: caravans on the road and ships on the lanes at middle and closest zoom, Roma selected and not',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = romaTradesThreeWays();
    await loadSave(page, state);
    const view = camera(page);
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y);
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await view.jumpTo(cityPoint('roma'), 1);
    await resume(page);
    await untilDay(page, 30, 0, 120_000);
    await playUntilDrawn(page, 'ships');
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-paths', '3');
    await shot(
      'middle-roma',
      'A month on, Roma selected: its three routes traced, ships along both lanes and caravans on the road north',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-paths', '0');
    await settled(page);
    await shot('middle', 'The same day with nothing selected: the merchants stay on the map');
    // The road to Mogontiacum runs north from Roma through the middle of the view.
    const road = tradeRoute(state, 'land');
    await view.jumpTo(routePoint({ ...road, returning: false }, 60 / road.km), 4);
    await playUntilDrawn(page, 'caravans');
    await shot(
      'closest',
      'The closest zoom on the road north of Roma, nothing selected: caravans coming and going',
    );
    const centre = view.city('roma');
    await page.mouse.click(centre.x, centre.y);
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    await settled(page);
    await shot(
      'closest-roma',
      'Roma selected at the closest zoom: its road and lane traced under the merchants',
    );
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await resume(page);
    await untilDay(page, 120, 0, 120_000);
    await playUntilDrawn(page, 'caravans');
    await shot(
      'closest-later',
      'Four months in, still Roma selected: the road still carries its caravans',
    );
  },
});
