import { expect } from '@playwright/test';
import { carthageClimbs } from '../../../e2e/climb-game.ts';
import { dropSave, openGame, pause, resume, untilDrawn } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'phone-corner',
  title:
    "At 390 × 844 the corner shows the latest news while the Chronicle is shut, and gives way to the Chronicle when it opens, so no line is cut at the window's foot",
  viewport: { width: 390, height: 844 },
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    await pause(page);
    await dropSave(page, carthageClimbs(0, 2));
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
    await untilDrawn(page);
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ hasText: /no longer count against Carthage's war: it stands/ })
      .waitFor();
    await pause(page);
    await untilDrawn(page);
    await shot(
      'corner-shut-390',
      'The Chronicle shut: the corner holds the latest news, and scrolls',
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(page.getByTestId('alerts')).toBeHidden();
    await untilDrawn(page);
    await shot(
      'corner-chronicle-390',
      'The Chronicle open: the corner gives way to it, and the Chronicle holds every line whole',
    );
  },
});
