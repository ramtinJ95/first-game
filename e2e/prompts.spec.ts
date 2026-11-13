import { expect, test, type Page } from '@playwright/test';
import { FATE_DAYS } from '../src/sim/cities.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  cityPoint,
  camera,
  dropSave,
  mediolanumFallsTomorrow,
  openGame,
  pause,
  resume,
  untilDay,
  untilDrawn,
} from './support.ts';

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

test.describe('the prompts say what they do', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
  });

  test('a choice of Occupy settles the fate at once: the city panel stops asking and no lapse is told', async ({
    page,
  }) => {
    const state = mediolanumFallsTomorrow();
    await load(page, state);
    await page.getByRole('button', { name: 'Resume' }).click();
    const prompt = page.getByTestId('fate-prompt');
    await prompt.getByTestId('fate-occupy').click();
    await expect(prompt).toHaveCount(0);

    await pause(page);
    await untilDrawn(page);
    const at = camera(page).screen({
      x: cityPoint('mediolanum').x,
      y: cityPoint('mediolanum').y + 40,
    });
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId('city-name')).toHaveText('Mediolanum');
    await expect(page.getByTestId('city-panel')).not.toContainText('Fate of the city');

    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await untilDay(page, state.day + FATE_DAYS + 3);
    await expect(page.getByTestId('alerts')).toContainText('Mediolanum fell to Rome');
    await expect(page.getByTestId('alerts')).not.toContainText('No fate was chosen');
  });
});
