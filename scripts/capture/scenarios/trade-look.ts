import { expect, type Page } from '@playwright/test';
import { camera, openGame, pause, resume, untilDrawn } from '../../../e2e/support.ts';
import { loadSave, untilDay } from '../../../e2e/watch.ts';
import { raidedRome, tradeRoute, tradingRome } from '../../../e2e/trade-game.ts';
import { routePoint } from '../../../src/sim/trade/routes.ts';
import { defineScenario } from '../scenario.ts';

async function settled(page: Page) {
  await page.locator('canvas[data-figure-sheets="ready"][data-terrain="ready"]').waitFor();
  await untilDrawn(page);
}

export default defineScenario({
  name: 'trade-look',
  clipSeconds: 90,
  title:
    'Merchant caravans and ships at middle and closest zoom, selected routes, province goods and a road raid',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = tradingRome();
    await loadSave(page, state);
    const view = camera(page);
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y);
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    const land = tradeRoute(state, 'land');
    await view.jumpTo(routePoint(land), 1.2);
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-figures', /[1-9]/);
    await expect(page.locator('canvas')).toHaveAttribute('data-goods', /[1-9]/);
    await settled(page);
    await shot(
      'caravan-middle',
      'A merchant cart and two walkers; Roma’s selected routes and the provinces’ goods share the map’s ink',
    );
    await view.jumpTo(routePoint(land), 4);
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-figures', /[1-9]/);
    await settled(page);
    await shot(
      'caravan-closest',
      'The caravan at closest zoom, drawn from the same crisp ink sheets as armies and refugee carts',
    );
    await page.getByRole('button', { name: 'Speed 1', exact: true }).click();
    await resume(page);
    await untilDay(page, state.day + 2);
    await pause(page);
    await untilDrawn(page);
    await shot(
      'caravan-moved',
      'Two days later the merchants have walked their road; movement follows the game clock',
    );
    await page.keyboard.press('Escape');
    await view.jumpTo(routePoint(land), 1.2);
    await loadSave(page, state);
    const sea = tradeRoute(state, 'sea');
    await view.jumpTo(routePoint(sea), 1.2);
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-ships', /[1-9]/);
    await settled(page);
    await shot(
      'ship-middle',
      'A single merchant ship at middle zoom, with the transport fleet’s ink and its own wake',
    );
    await view.jumpTo(routePoint(sea), 4);
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-ships', /[1-9]/);
    await settled(page);
    await shot('ship-closest', 'The merchant ship at closest zoom');
    await view.jumpTo(routePoint(sea), 1.2);
    const raided = raidedRome();
    await loadSave(page, raided);
    const raid = tradeRoute(raided, 'land').raid;
    if (!raid) throw new Error('expected a recorded road raid');
    await view.jumpTo(raid.position, 4);
    await expect(page.locator('canvas')).toHaveAttribute('data-trade-figures', /[1-9]/);
    await expect(page.locator('canvas')).toHaveAttribute('data-raids', '1');
    await settled(page);
    await shot(
      'road-raid',
      'The raider stands by a damaged cart and settling dust at the recorded attack, not at the reset origin',
    );
  },
});
