import { expect, test, type Page } from '@playwright/test';
import { screenToMap } from '../src/render/camera.ts';
import { BANNER } from '../src/render/markers.ts';
import { provinceAt } from '../src/render/pick.ts';
import { FATE_DAYS } from '../src/sim/cities.ts';
import { saveGame } from '../src/sim/save.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  cityPoint,
  camera,
  dropSave,
  map,
  mediolanumFallsTomorrow,
  openGame,
  pause,
  resume,
  startGame,
  untilDay,
  clearCentre,
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

/**
 * Clicks the flag of the banner whose foot stands at the screen point. The flag is a
 * small target, so the click finds the army only when the map put it at that point.
 */
async function clickFlagAt(page: Page, foot: { x: number; y: number }) {
  await page.mouse.click(foot.x + BANNER.flagWidth / 2, foot.y - BANNER.pole + 5);
}

test.describe('a click goes where it is aimed', () => {
  test('a click on the edge of a coastal city, over the sea, selects the city', async ({
    page,
  }) => {
    await openGame(page);
    await load(page, startGame());
    const view = camera(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    const at = view.city('massalia');
    const offsets = [3, 4, 5, 6, 7].flatMap((d) => [
      { x: 0, y: d },
      { x: d, y: d },
      { x: -d, y: d },
      { x: 0, y: -d },
    ]);
    const sea = offsets
      .map((offset) => ({ x: at.x + offset.x, y: at.y + offset.y }))
      .find((point) => !provinceAt(map, screenToMap(view.camera, viewport, point)));
    if (!sea) throw new Error('no sea beside Massalia');
    await page.mouse.click(sea.x, sea.y);
    await expect(page.getByTestId('city-name')).toHaveText('Massalia');
  });

  test("a row of the overview centres its city clear of the open panels, with Rome's army on it", async ({
    page,
  }) => {
    await openGame(page);
    await load(page, startGame());
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('overview-cities').getByRole('button', { name: /^Roma/ }).click();
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    await untilDrawn(page);
    await clickFlagAt(page, await clearCentre(page));
    await expect(page.getByTestId('army-panel').getByRole('heading', { level: 2 })).toHaveText(
      'Army of Rome',
    );
  });

  test('a save loaded from the Game menu centres the capital clear of the top bar', async ({
    page,
  }) => {
    await page.addInitScript((text) => {
      localStorage.setItem(
        'save:auto',
        JSON.stringify({ savedAt: 1, day: 1, realm: 'Rome', text }),
      );
    }, saveGame(startGame()));
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('top-bar').waitFor();
    await untilDrawn(page);
    await clickFlagAt(page, await clearCentre(page));
    await expect(page.getByTestId('army-panel').getByRole('heading', { level: 2 })).toHaveText(
      'Army of Rome',
    );
  });
});
