import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  camera,
  cityPoint,
  dropSave,
  fiveFleetsOnRoma,
  openGame,
  pause,
  resume,
  romaMustersUnderSiege,
  sackedMediolanum,
  sixSpearmenMusterTomorrow,
  storesAtTheirLimits,
  untilDrawn,
  weakSiegeOfMediolanum,
  worldNewsTomorrow,
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

/** Rome's army stands on the city's symbol, so the click goes to its province 40 km south. */
async function openMediolanum(page: Page) {
  const at = cityPoint('mediolanum');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText('Mediolanum');
}

test.describe('what the page tells of stores, cities, and sieges', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
  });

  test('six formations that muster at one city on one day read as one alert with a count', async ({
    page,
  }) => {
    await load(page, sixSpearmenMusterTomorrow());
    await resume(page);
    const line = page
      .getByTestId('alerts')
      .getByRole('button', { name: /Spearmen mustered at Roma/ });
    await expect(line).toHaveCount(1);
    await expect(line.getByTestId('alert-count')).toHaveText('×6');
  });

  test('a besieged city of the player that musters its recruits early is told of', async ({
    page,
  }) => {
    await load(page, romaMustersUnderSiege());
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      'Besieged Roma mustered its recruits early: 2 Spearmen and Archers. It cannot fall or be stormed while they stand',
    );
  });

  test('the city panel of a sacked city gives its harvest and how long its gold stays low', async ({
    page,
  }) => {
    const state = sackedMediolanum();
    await load(page, state);
    await openMediolanum(page);
    const panel = page.getByTestId('city-panel');
    await expect(panel.getByTestId('city-sacked')).toHaveText(
      `Sacked on day 1: yields half its gold for ${(3 * 365 - (state.day - 1)).toLocaleString('en')} more days`,
    );
    await expect(panel.getByTestId('city-food-balance')).toHaveText(
      /^Grows \d+\.\d, eats \d+\.\d a day · [+−]\d+\.\d$/,
    );
  });

  test('the top bar says when food and manpower stop at their limits', async ({ page }) => {
    await load(page, storesAtTheirLimits());
    await expect(page.getByTestId('store-food-note')).toHaveText('Full');
    await expect(page.getByTestId('store-food')).toHaveAttribute('title', /^Granaries full\. /);
    await expect(page.getByTestId('store-manpower-note')).toHaveText('At limit');
    await expect(page.getByTestId('store-manpower')).toHaveAttribute(
      'title',
      /^At the call-up limit\. /,
    );
  });

  test('the army and city panels of a siege too weak to cut the food say how many men it needs', async ({
    page,
  }) => {
    const state = weakSiegeOfMediolanum();
    await load(page, state);
    const text =
      /^Too few to starve Mediolanum: [\d,]+ besiegers against a garrison of [\d,]+\. The food does not fall, and sallies cut down besiegers each day\. [\d,]+ more men would cut the food\.$/;
    await openMediolanum(page);
    await expect(page.getByTestId('city-weak-siege')).toHaveText(text);
    await page.getByRole('button', { name: 'Overview' }).click();
    await page
      .getByTestId('overview')
      .getByRole('button', { name: /Besieging Mediolanum/ })
      .click();
    await expect(page.getByTestId('army-weak-siege')).toHaveText(text);
  });
});

test('news of the world out of sight reaches the player: a fallen capital in the corner, a city near its land in the chronicle only', async ({
  page,
}) => {
  await openGame(page);
  const state = worldNewsTomorrow();
  await load(page, state);
  await resume(page);
  const corner = page.getByTestId('alerts');
  const capital = corner.getByRole('button', {
    name: /Carthago, the capital of Carthage, fell to Egypt/,
  });
  await expect(capital).toBeVisible();
  await pause(page);
  await expect(corner).not.toContainText('Mediolanum fell to Macedon');

  await page.getByRole('button', { name: 'Chronicle' }).click();
  const chronicle = page.getByTestId('chronicle');
  await expect(chronicle).toContainText('Carthago, the capital of Carthage, fell to Egypt');
  await expect(chronicle).toContainText('Mediolanum fell to Macedon, 306 km from your land');

  // The world's news is drawn quieter than the player's own.
  const style = (text: string) =>
    chronicle
      .getByRole('button', { name: new RegExp(text) })
      .locator('.text')
      .evaluate((element) => getComputedStyle(element).fontStyle);
  expect(await style('fell to Egypt')).toBe('italic');
});

test("five of an enemy's fleets seen on one day sailing for Roma read as one alert with all their men", async ({
  page,
}) => {
  await openGame(page);
  await load(page, fiveFleetsOnRoma());
  await resume(page);
  const line = page.getByTestId('alerts').getByRole('button', { name: /fleets? of Carthage/ });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('5 fleets of Carthage with 2,129 men are sailing for Roma');
});
