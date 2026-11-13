import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dropSave, openGame, pause, rome, startGame, untilDrawn } from './support.ts';

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(name: string, locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (!found) throw new Error(`${name} is not on the page`);
  return { name, ...found };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** Rome has no gold or food left, so both stores show that they ran out. */
function storesRunOut(): GameState {
  const state = startGame();
  const stores = state.factions[rome]?.stores;
  if (!stores) throw new Error('no stores of Rome');
  stores.gold = -120;
  stores.food = -40;
  return state;
}

/** The top bar's items, each of which must sit on the bar's one row. */
async function barItems(page: Page): Promise<Box[]> {
  const bar = page.getByTestId('top-bar');
  return [
    await box('the realm', bar.getByRole('strong').first()),
    ...(await Promise.all(
      ['gold', 'food', 'manpower'].map((store) =>
        box(`the ${store}`, bar.getByTestId(`store-${store}`)),
      ),
    )),
    await box('the date', bar.getByTestId('time-controls-day')),
    await box('Resume', bar.getByRole('button', { name: 'Resume' })),
    await box('Speed 3', bar.getByRole('button', { name: 'Speed 3', exact: true })),
    await box('Overview', bar.getByRole('button', { name: 'Overview' })),
    await box('Game', bar.getByRole('button', { name: 'Game', exact: true })),
  ];
}

test.describe('the Game menu at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('lies inside the page', async ({ page }) => {
    await openGame(page);
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    const menu = await box('the Game menu', page.getByTestId('save-menu'));
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(1280);
    expect(menu.y + menu.height).toBeLessThanOrEqual(720);
  });
});

for (const width of [1024, 1280, 1600]) {
  test.describe(`the top bar at ${width} px`, () => {
    test.use({ viewport: { width, height: 768 } });

    test('keeps one row with two stores run out, and says so on each', async ({ page }) => {
      await openGame(page);
      await load(page, storesRunOut());
      const bar = page.getByTestId('top-bar');
      for (const store of ['gold', 'food']) {
        await expect(bar.getByTestId(`store-${store}-note`)).toBeVisible();
      }

      const items = await barItems(page);
      const lowestTop = Math.max(...items.map((item) => item.y));
      const highestBottom = Math.min(...items.map((item) => item.y + item.height));
      expect(
        items.filter((item) => item.y >= highestBottom).map((item) => item.name),
        `every item shares one row (lowest top ${lowestTop}, highest bottom ${highestBottom})`,
      ).toEqual([]);
      const whole = await box('the top bar', bar);
      expect(whole.x + whole.width).toBeLessThanOrEqual(width);
      const side = page.getByRole('complementary', { name: 'Selection' });
      if ((await side.boundingBox())?.height) {
        expect(overlaps(whole, await box('the side column', side))).toBe(false);
      }
      for (const store of ['gold', 'food']) {
        await expect(bar.getByTestId(`store-${store}`)).toHaveAttribute(
          'title',
          /formations desert/,
        );
      }
    });
  });
}

test.describe('the frame readout', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('covers none of the top bar', async ({ page }) => {
    await openGame(page, { query: 'frames' });
    const meter = await box('the frame readout', page.getByTestId('frame-meter'));
    const bar = await box('the top bar', page.getByTestId('top-bar'));
    expect(overlaps(meter, bar), 'the readout covers the top bar').toBe(false);
    expect(meter.x + meter.width).toBeLessThanOrEqual(1280);
    expect(meter.y + meter.height).toBeLessThanOrEqual(720);
  });
});
