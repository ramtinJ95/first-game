import { expect } from '@playwright/test';
import { crowdedBar } from '../../../e2e/crowded-bar.ts';
import { carthageClimbs } from '../../../e2e/climb-game.ts';
import { dropSave, openGame, pause, resume, untilDrawn } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'phone-top-bar',
  title:
    'At 390 × 844, with a war, a threat, an advance at work and food short, every top bar button is whole on the page, and the Game menu opens whole below the bar; the Advances panel takes the middle of the screen while news that stopped the game waits',
  viewport: { width: 390, height: 844 },
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    await dropSave(page, crowdedBar());
    await expect(page.getByTestId('study-days')).toHaveText('240 days');
    await untilDrawn(page);
    await shot(
      'top-bar-390',
      'The top bar at its longest: Wars 1 with a threat, Advances with its days, food Short, and the buttons on a row of their own',
    );
    await page.getByRole('button', { name: 'Game' }).click();
    await expect(page.getByTestId('save-menu')).toBeVisible();
    await shot('game-menu-390', 'The Game menu open, across the bar, each entry whole');
    await page.getByRole('button', { name: 'Game' }).click();

    await openGame(page, { pauses: true });
    await pause(page);
    await dropSave(page, carthageClimbs(8, 2));
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
    await untilDrawn(page);
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ hasText: /Carthage stands higher/ })
      .waitFor();
    await page.getByTestId('advances-button').click();
    await expect(page.getByTestId('advances')).toBeVisible();
    await untilDrawn(page);
    await shot(
      'advances-390',
      'The Advances panel at 390 × 844 while news that stopped the game stands: the panel takes the middle of the screen and scrolls, and the news waits in the Chronicle',
    );
  },
});
