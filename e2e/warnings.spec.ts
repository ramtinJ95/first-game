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
import { dateText } from '../src/app/names.ts';
import { fixtureWorld } from '../src/sim/fixture.ts';
import { tick } from '../src/sim/tick.ts';
import {
  foodShortfall,
  loadWarnings,
  ownCityInDangerTomorrow,
  ownSiegeTomorrow,
  foodShortUnlessWaiting,
  showOwnCity,
  slowFoodDeficit,
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
  await expect(page.getByTestId('recruit-forecast')).toHaveCount(1);
  await expect(page.getByTestId('recruit-cards')).not.toContainText('Realm');
  await expect(page.getByTestId('recruit-cards')).not.toContainText('Shortfall');
  await expect(page.getByTestId('recruit-cards').getByRole('button')).toHaveCount(6);
  await spears.click();
  const warning = page.getByTestId('recruit-warning');
  await expect(warning).toContainText('Food shortfall: stores last about 8 days');
  await expect(page.getByTestId('recruit-runway-food')).toHaveText(
    'Food: about 8 days left as the people grow',
  );
  await expect(page.getByTestId('store-food-note')).toHaveText('8 days left');
  await expect(warning).toContainText('Gold shortfall: stores last about 823 days');
  await expect(page.getByTestId('recruit-runway-food')).toHaveClass('bad');
  await expect(page.getByTestId('recruit-runway-gold')).toHaveText(
    'Gold: about 823 days left as the people grow',
  );
  await expect(page.getByTestId('recruit-runway-gold')).toHaveClass('bad');
  await expect(page.getByTestId('city-raising')).not.toContainText('ordered');
  await warning.getByRole('button', { name: 'Raise anyway' }).click();
  await expect(page.getByTestId('city-raising')).toContainText(
    'Spearmen · ordered for the next day',
  );
});

test('a lasting gold deficit more than two years away still asks Raise anyway', async ({
  page,
}) => {
  await openGame(page);
  const state = foodShortfall();
  for (const city of Object.values(state.cities))
    if (city.owner === rome) city.buildings.push('canals');
  await loadWarnings(page, state);
  await showOwnCity(page, 'Roma');
  await page
    .getByTestId('recruit-cards')
    .getByRole('button', { name: /^Spearmen/ })
    .click();
  const warning = page.getByTestId('recruit-warning');
  await expect(warning).toContainText('Gold shortfall: stores last about 823 days');
  await expect(page.getByTestId('recruit-runway-gold')).toHaveClass('bad');
  await expect(page.getByTestId('recruit-forecast')).toContainText('−21.6 gold/day');
  await expect(page.getByTestId('city-raising')).not.toContainText('ordered');
  await warning.getByRole('button', { name: 'Raise anyway' }).click();
  await expect(page.getByTestId('city-raising')).toContainText(
    'Spearmen · ordered for the next day',
  );
});

test('a shortfall the filling granary would carry names the day to raise instead of refusing', async ({
  page,
}) => {
  await openGame(page);
  const state = foodShortUnlessWaiting();
  await loadWarnings(page, state);
  await showOwnCity(page, 'Roma');
  await page
    .getByTestId('recruit-cards')
    .getByRole('button', { name: /^Spearmen/ })
    .click();
  const warning = page.getByTestId('recruit-warning');
  await expect(warning).toContainText('Food shortfall: stores last about 602 days');
  await expect(warning).toContainText(
    `Stores grow while you wait: raised in about 838 days, on ${dateText(state.day + 838)}, these men are fed as the people grow, if you raise no other troops and lose no city before then. Raise now only if you need them sooner.`,
  );
  await expect(warning).not.toContainText('Raise fewer troops');
  await warning.getByRole('button', { name: 'Raise anyway' }).click();
  await expect(page.getByTestId('city-raising')).toContainText(
    'Spearmen · ordered for the next day',
  );
});

test('on the day a warned raise named, the same card raises at once and the old warning does not stay open', async ({
  page,
}) => {
  await openGame(page);
  const state = foodShortUnlessWaiting();
  await loadWarnings(page, state);
  await showOwnCity(page, 'Roma');
  const cards = page.getByTestId('recruit-cards');
  await cards.getByRole('button', { name: /^Spearmen/ }).click();
  const warning = page.getByTestId('recruit-warning');
  await expect(warning).toContainText('raised in about 838 days');
  const world = fixtureWorld();
  let named = state;
  for (let day = 0; day < 838; day++) named = tick(named, [], world).state;
  await loadWarnings(page, named);
  await showOwnCity(page, 'Roma');
  await cards.getByRole('button', { name: /^Spearmen/ }).click();
  await expect(page.getByTestId('city-raising')).toContainText(
    'Spearmen · ordered for the next day',
  );
  await expect(warning).toHaveCount(0);
});

test('a raise that moves the named day is told on the card, with what moved it', async ({
  page,
}) => {
  await openGame(page);
  await loadWarnings(page, foodShortUnlessWaiting());
  await showOwnCity(page, 'Roma');
  const cards = page.getByTestId('recruit-cards');
  const warning = page.getByTestId('recruit-warning');
  await cards.getByRole('button', { name: /^Spearmen/ }).click();
  await expect(warning).toContainText('on Year 3, day 109');
  await expect(page.getByTestId('recruit-moved')).toHaveCount(0);
  await warning.getByRole('button', { name: 'Cancel raising' }).click();
  await cards.getByRole('button', { name: /^Skirmishers/ }).click();
  await expect(page.getByTestId('city-raising')).toContainText(
    'Skirmishers · ordered for the next day',
  );
  await cards.getByRole('button', { name: /^Spearmen/ }).click();
  await expect(page.getByTestId('recruit-moved')).toHaveText(
    /^Now Year 10, day \d+, not Year 3, day 109 as this card said on Year 1, day 1: since then you raised 500 Skirmishers, who are fed first\.$/,
  );

  await loadWarnings(page, foodShortUnlessWaiting());
  await showOwnCity(page, 'Roma');
  await cards.getByRole('button', { name: /^Spearmen/ }).click();
  await expect(warning).toContainText('on Year 3, day 109');
  await expect(page.getByTestId('recruit-moved')).toHaveCount(0);
});

test('a small deficit that the growing people close stays plain and raises at once', async ({
  page,
}) => {
  await openGame(page);
  await loadWarnings(page, slowFoodDeficit());
  await showOwnCity(page, 'Roma');
  await page
    .getByTestId('recruit-cards')
    .getByRole('button', { name: /^Spearmen/ })
    .click();
  await expect(page.getByTestId('recruit-warning')).toHaveCount(0);
  await expect(page.getByTestId('city-raising')).toContainText(
    'Spearmen · ordered for the next day',
  );
  await expect(page.getByTestId('recruit-runway-food')).toHaveText(
    "Food: stores last about 2,808 days at today's yields, but the people's growth closes the gap first",
  );
  await expect(page.getByTestId('recruit-runway-food')).not.toHaveClass('bad');
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
  await expect(page.getByTestId('alerts')).toContainText(
    'The men of Mediolanum held the field at their city',
  );
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
