import { expect, test } from '@playwright/test';
import {
  day,
  fallsTomorrow,
  openGame,
  pause,
  resume,
  rome,
  carthage,
  romaFallsTomorrow,
  untilDay,
  startGame,
  armyOf,
  cityPoint,
  withFormations,
  outnumberedAt,
} from './support.ts';
import { allocateId } from '../src/sim/ids.ts';
import {
  foodShortfall,
  loadWarnings,
  ownCityInDangerTomorrow,
  ownSiegeTomorrow,
  showOwnCity,
  smallSallyTomorrow,
} from './warnings-game.ts';

test('recruitment forecasts upkeep and demands confirmation before a food shortfall order', async ({
  page,
}) => {
  await openGame(page);
  await loadWarnings(page, foodShortfall());
  await showOwnCity(page, 'Roma');
  const spears = page.getByTestId('city-panel').getByRole('button', { name: /^Spearmen/ });
  await expect(spears).toContainText('Upkeep −6.0 food, −10.0 gold/day');
  await expect(spears).toContainText('Realm after all recruits muster');
  await spears.click();
  const warning = page.getByTestId('recruit-warning');
  await expect(warning).toContainText(/Food shortfall.*run short in about \d+ days/);
  await expect(page.getByTestId('city-raising')).not.toContainText('ordered');
  await warning.getByRole('button', { name: 'Raise anyway' }).click();
  await expect(page.getByTestId('city-raising')).toContainText(
    'Spearmen · ordered for the next day',
  );
});

test('hunger keeps a standing desertion line after its first alert', async ({ page }) => {
  await openGame(page);
  const state = foodShortfall();
  required(state.factions[rome]).stores.food = -1000;
  await loadWarnings(page, state);
  await resume(page);
  await untilDay(page, state.day + 3);
  await pause(page);
  await expect(page.getByTestId('desertion-standing')).toContainText('Men desert each day: hunger');
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
  await expect(page.getByTestId('chronicle').getByText(/Desertion has begun/)).toHaveCount(1);
});

test('a Join ordered while paused is acknowledged in the army panel', async ({ page }) => {
  await openGame(page);
  const state = startGame();
  const first = armyOf(state, rome);
  first.activity = { kind: 'idle', position: cityPoint('roma') };
  const id = allocateId(state, 'army');
  state.armies[id] = { ...first, id, name: 'Second Legion', formations: [] };
  withFormations(state, required(state.armies[id]), [['spearmen', 1000]]);
  await loadWarnings(page, state);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page
    .getByTestId('overview-armies')
    .getByRole('button', { name: /Second Legion/ })
    .click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Join First Legion', exact: true }).click();
  await expect(page.getByTestId('join-ordered')).toHaveText(
    'Join First Legion ordered for the next day',
  );
  await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
});

test('stance advice leaves the last battle row reachable at 1280x600', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openGame(page);
  const state = startGame();
  outnumberedAt(state, 'roma', 1500);
  await loadWarnings(page, state);
  await resume(page);
  await expect(page.getByTestId('battle-panel')).toBeVisible();
  await pause(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByTestId('overview-armies').getByRole('button').first().click();
  await expect(page.getByTestId('stance-ai-rule')).toContainText(
    'It may answer your change after you re-form',
  );
  const side = page.getByRole('complementary', { name: 'Selection' });
  await side.evaluate((element) => (element.scrollTop = element.scrollHeight));
  const column = await side.boundingBox();
  const row = await page.getByTestId('battle-army').last().boundingBox();
  if (!column || !row) throw new Error('Battle row missing');
  expect(row.y).toBeGreaterThanOrEqual(column.y);
  expect(row.y + row.height).toBeLessThanOrEqual(Math.min(column.y + column.height, 600) + 1);
});

for (const [name, make, line] of [
  ['begins', ownSiegeTomorrow, /besieges Capua/],
  ['is about to fall', ownCityInDangerTomorrow, /Capua is in danger: 7 days of food/],
] as const) {
  test(`an own city pauses on the day its siege ${name}`, async ({ page }) => {
    await openGame(page, { pauses: true });
    const state = make();
    await loadWarnings(page, state);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await expect(
      page.getByTestId('alerts').getByRole('button').filter({ hasText: line }),
    ).toContainText('Paused');
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    expect(await day(page)).toBe(state.day + 1);
    if (name === 'is about to fall')
      await expect(page.getByTestId('alerts')).toContainText(/Relieve.*sally.*peace/);
  });
}

test('the fall of an own city pauses before the last city, and the setting turns off siege pauses', async ({
  page,
}) => {
  await openGame(page, { pauses: true });
  const state = ownSiegeTomorrow();
  fallsTomorrow(state, 'capua', carthage);
  await loadWarnings(page, state);
  await resume(page);
  await expect(
    page.getByTestId('alerts').getByRole('button').filter({ hasText: 'Capua fell to Carthage' }),
  ).toContainText('Paused');
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.getByTestId('pause-ownCity').uncheck();
  await page.keyboard.press('Escape');
  const begun = ownSiegeTomorrow();
  await loadWarnings(page, begun);
  await resume(page);
  await untilDay(page, begun.day + 2);
  await expect(page.getByTestId('time-controls-speed')).not.toHaveText('Paused');
});

test('a one-day small sally stays in the Chronicle with one quiet result, without pausing', async ({
  page,
}) => {
  await openGame(page, { pauses: true });
  const state = smallSallyTomorrow();
  await loadWarnings(page, state);
  await resume(page);
  await untilDay(page, state.day + 3);
  await expect(page.getByTestId('time-controls-speed')).not.toHaveText('Paused');
  await pause(page);
  await expect(page.getByTestId('alerts')).toContainText('after 1 day');
  await expect(page.getByTestId('alert-paused')).toHaveCount(0);
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
  await expect(page.getByTestId('chronicle')).toContainText('Battle');
  await expect(page.getByTestId('chronicle')).toContainText('after 1 day');
});

test('defeat is a focused modal dialog with an inert page and a click-taking backdrop', async ({
  page,
}) => {
  await openGame(page, { pauses: true });
  await loadWarnings(page, romaFallsTomorrow());
  await resume(page);
  const dialog = page.getByRole('dialog', { name: 'Rome has fallen' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('button', { name: 'Watch on' })).toBeFocused();
  // A real click over the Game button hits the modal backdrop, not the underlying menu.
  const game = await page.getByRole('button', { name: 'Game', exact: true }).boundingBox();
  if (!game) throw new Error('Game button missing');
  await page.mouse.click(game.x + game.width / 2, game.y + game.height / 2);
  await expect(page.getByTestId('save-menu')).toBeHidden();
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Warning fixture record missing');
  return value;
}
