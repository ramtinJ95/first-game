import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  camera,
  cityPoint,
  day,
  outnumberedAt,
  startGame,
  mediolanumFallsTomorrow,
  openGame,
  pause,
  resizeTo,
  untilDrawn,
} from './support.ts';
import { loadSave } from './watch.ts';

/** Rome's army beside Roma and Carthage's of 1,500 men, at war, so they fight the next day. */
function battleTomorrow() {
  const state = startGame();
  outnumberedAt(state, 'roma', 1500);
  return state;
}

const speed3 = (page: Page) => page.getByRole('button', { name: 'Speed 3', exact: true }).click();

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Game' }).click();
  await expect(page.getByTestId('save-menu')).toBeVisible();
}

async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-menu')).toBeHidden();
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator): Promise<Box | undefined> {
  return (await locator.isVisible()) ? ((await locator.boundingBox()) ?? undefined) : undefined;
}

test.describe('the game stops when the player must decide', () => {
  test('a battle of the player that begins at speed 3 pauses the game on its first day', async ({
    page,
  }) => {
    await openGame(page, { pauses: true });
    await pause(page);
    const state = battleTomorrow();
    await loadSave(page, state);
    await speed3(page);
    await page.getByRole('button', { name: 'Resume' }).click();
    const paused = page.getByTestId('alerts').getByTestId('alert-paused');
    await expect(paused).toBeVisible();
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    expect(await day(page)).toBe(state.day + 1);
    await expect(page.getByTestId('battle-panel')).toBeVisible();
    await expect(page.getByTestId('alerts').getByRole('button').first()).toContainText(
      /Paused Battle at Roma against Carthage/,
    );
  });

  test('with its setting off, a battle does not pause the game, and the setting is kept', async ({
    page,
  }) => {
    await openGame(page, { pauses: true });
    await pause(page);
    await openMenu(page);
    await expect(page.getByTestId('pause-battle')).toBeChecked();
    await page.getByTestId('pause-battle').uncheck();
    await closeMenu(page);
    const state = battleTomorrow();
    await loadSave(page, state);
    await speed3(page);
    await page.getByRole('button', { name: 'Resume' }).click();
    const battleDay = page.getByTestId('battle-panel').getByTestId('battle-day');
    // A slow frame plays several days at once, so the panel can pass over day 3.
    await expect
      .poll(async () => Number(/\d+/.exec((await battleDay.textContent()) ?? '')?.[0] ?? 0))
      .toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Speed 3');
    await expect(page.getByTestId('alert-paused')).toHaveCount(0);

    await openGame(page, { pauses: true });
    await openMenu(page);
    await expect(page.getByTestId('pause-battle')).not.toBeChecked();
    await expect(page.getByTestId('pause-weakSiege')).toBeChecked();
    await expect(page.getByTestId('pause-sighted')).toBeChecked();
  });
});

test('loading a save puts back the camera, the selection, the open panel, and the chronicle', async ({
  page,
}) => {
  await openGame(page);
  await pause(page);
  await loadSave(page, battleTomorrow());
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('battle-panel')).toBeVisible();
  await pause(page);
  const told = await page.getByTestId('alerts').getByRole('button').allInnerTexts();
  expect(told.length).toBeGreaterThan(0);

  const view = camera(page);
  await view.jumpTo(cityPoint('roma'), 0.7);
  await untilDrawn(page);
  const capua = view.city('capua');
  await page.mouse.click(capua.x, capua.y);
  await expect(page.getByTestId('city-name')).toHaveText('Capua');
  await page.getByRole('button', { name: 'Chronicle' }).click();
  await expect(page.getByTestId('chronicle')).toBeVisible();
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Save in this browser' }).click();

  await page.reload();
  await page.getByTestId('top-bar').waitFor();
  await expect(page.getByTestId('city-panel')).toBeHidden();
  await expect(page.getByTestId('chronicle')).toBeHidden();

  await openMenu(page);
  await page.getByRole('menuitem', { name: /Load your save/ }).click();
  await expect(page.getByTestId('city-name')).toHaveText('Capua');
  await expect(page.getByTestId('chronicle').getByRole('listitem')).toHaveCount(told.length);
  await expect(page.getByTestId('alerts').getByRole('button')).toHaveText(told);

  await untilDrawn(page);
  const arretium = view.city('arretium');
  await page.mouse.click(arretium.x, arretium.y);
  await expect(page.getByTestId('city-name')).toHaveText('Arretium');
});

test.describe('one stance block, and a side column that scrolls to its last row', () => {
  for (const height of [720, 600]) {
    test(`at 1280x${height}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height });
      await openGame(page);
      await pause(page);
      await loadSave(page, battleTomorrow());
      await page.getByRole('button', { name: 'Resume' }).click();
      await expect(page.getByTestId('battle-panel')).toBeVisible();
      await pause(page);
      await page.getByRole('button', { name: 'Overview' }).click();
      await page.getByTestId('overview-armies').getByRole('button').first().click();
      await expect(page.getByTestId('army-name')).toHaveText('First Legion');
      await expect(page.getByTestId('army-in-battle')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Stance' })).toHaveCount(1);

      const side = page.getByRole('complementary', { name: 'Selection' });
      await side.evaluate((element) => (element.scrollTop = element.scrollHeight));
      const last = page.getByTestId('battle-army').last();
      const column = await side.boundingBox();
      const row = await last.boundingBox();
      if (!column || !row) throw new Error('no side column or battle row');
      expect(row.y + row.height).toBeLessThanOrEqual(
        Math.min(column.y + column.height, height) + 1,
      );
      expect(row.y).toBeGreaterThanOrEqual(column.y);
    });
  }
});

test('at 390 px wide nothing covers the open sheet', async ({ page }) => {
  await openGame(page);
  await pause(page);
  await resizeTo(page, { width: 390, height: 844 });
  await loadSave(page, battleTomorrow());
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('battle-panel')).toBeVisible();
  await pause(page);
  await expect(page.getByTestId('alerts')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.getByTestId('overview-armies').getByRole('button').first().click();
  const sheet = await boxOf(page.getByRole('complementary', { name: 'Selection' }));
  if (!sheet) throw new Error('no sheet');
  for (const testid of ['top-bar', 'alerts', 'overview', 'chronicle']) {
    const box = await boxOf(page.getByTestId(testid));
    if (box) expect(overlaps(box, sheet), `${testid} over the sheet`).toBe(false);
  }
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Chronicle' }).click();
  const chronicle = await boxOf(page.getByTestId('chronicle'));
  if (chronicle) expect(overlaps(chronicle, sheet), 'the chronicle over the sheet').toBe(false);
});

test('the fate prompt and the city panel give the same days of unrest on the same day', async ({
  page,
}) => {
  await openGame(page);
  await pause(page);
  await loadSave(page, mediolanumFallsTomorrow());
  const view = camera(page);
  await view.jumpTo(cityPoint('mediolanum'), 0.7);
  await untilDrawn(page);
  const city = view.city('mediolanum');
  await page.mouse.click(city.x, city.y);
  await expect(page.getByTestId('city-name')).toHaveText('Mediolanum');
  await page.getByRole('button', { name: 'Resume' }).click();
  const prompt = page.getByTestId('fate-prompt');
  await expect(prompt).toBeVisible();
  const days = await prompt.getByTestId('fate-occupy-unrest').innerText();
  expect(days).toMatch(/^\d+ days left$/);
  await expect(page.getByTestId('city-unrest')).toHaveText(`Unrest · ${days}`);
  await expect(prompt.getByTestId('fate-occupy-calm')).toHaveText(
    /^\+\d+\.\d gold, \+\d+\.\d food/,
  );
  await expect(prompt.getByTestId('fate-sack-now')).toHaveText(/^\+[\d,]+ gold, −[\d,]+ people$/);
});
