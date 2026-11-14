import { expect, test } from '@playwright/test';
import {
  discoveryGame,
  fullBuildingGame,
  convoyOverRoma,
  loadDiscovery,
  pickCity,
  staggeredSiege,
  showSiegeWarning,
  pickMinor,
  minorSamples,
  queueStance,
} from './guide-game.ts';
import { openGame, resizeTo, startGame } from './support.ts';

test('the guide teaches buildings, peace, news, automatic pauses, and the real sea controls', async ({
  page,
}) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  const guide = page.getByTestId('guide');
  for (const heading of [
    'Buildings and stores',
    'Wars and peace',
    'Overview and Chronicle',
    'Pause and speed',
  ])
    await expect(guide.locator('dt').filter({ hasText: heading })).toHaveCount(1);
  await expect(guide).toContainText('ships also gather on a shore');
  await expect(guide).toContainText('An offer of peace pauses for your answer');
  await expect(guide).not.toContainText('halts beside an enemy');
});

for (const width of [1280, 1024])
  test(`Wars and waiting offers fit one top-bar row at ${width}px with the longest store notes`, async ({
    page,
  }) => {
    await openGame(page);
    await resizeTo(page, { width, height: 768 });
    await loadDiscovery(page, discoveryGame());
    const bar = page.getByTestId('top-bar');
    await expect(bar.getByTestId('store-food-note')).toHaveText('Full tomorrow');
    await expect(bar.getByTestId('store-manpower-note')).toHaveText('At the call-up limit');
    await queueStance(page);
    const wars = bar.getByRole('button', { name: 'Wars 1, 1 offer waiting', exact: true });
    await expect(wars).toBeVisible();
    const boxes = await bar
      .locator(':scope > *, .store, .end > *, [data-testid="time-controls"] > *')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
        }),
      );
    expect(Math.max(...boxes.map((b) => b.y))).toBeLessThan(
      Math.min(...boxes.map((b) => b.bottom)),
    );
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    await wars.click();
    await expect(page.getByTestId('wars-panel')).toBeVisible();
    await expect(page.getByTestId('their-offer')).toBeVisible();
  });

test('wasted Canals and a Temple with no unrest explain today without disabling the order', async ({
  page,
}) => {
  await openGame(page);
  await loadDiscovery(page, fullBuildingGame());
  await pickCity(page, 'roma');
  const canals = page.getByTestId('build-canals');
  await expect(canals).toContainText('Food full: the extra daily gain would be lost now');
  await expect(canals).toBeEnabled();
  await expect(page.getByTestId('build-temple')).toContainText(
    'No city whose unrest this would hasten is in unrest now',
  );
  await expect(page.getByTestId('build-temple')).toBeEnabled();
});

test('the siege order names the second legion and the days the first waits alone', async ({
  page,
}) => {
  await openGame(page);
  await loadDiscovery(page, staggeredSiege());
  await showSiegeWarning(page);
  await expect(page.getByTestId('notice')).toContainText('stands alone for 17 days');
  await expect(page.getByTestId('notice')).toContainText('enough to hold the siege before losses');
});

test('a city symbol under a convoy wins the click; Armies here reaches the convoy', async ({
  page,
}) => {
  await openGame(page);
  await loadDiscovery(page, convoyOverRoma());
  await pickCity(page, 'roma');
  await page
    .getByTestId('armies-here')
    .getByRole('button', { name: /Carthage/ })
    .click();
  await expect(page.getByTestId('army-name')).toContainText('Host of Hanno');
});

test('all four minor kinds have a kind line', async ({ page }) => {
  const state = startGame();
  await openGame(page);
  await loadDiscovery(page, state);
  const labels = {
    rich: 'Rich and walled',
    poor: 'Poor and open',
    leagued: 'Leagued with',
    standing: 'Standing-army city',
  };
  for (const [kind, city] of minorSamples(state)) {
    await pickMinor(page, state, city);
    await expect(page.getByTestId('city-minor')).toContainText(labels[kind]);
  }
});
