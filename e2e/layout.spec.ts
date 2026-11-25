import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { carthageClimbs } from './climb-game.ts';
import {
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resume,
  rome,
  startGame,
  untilDay,
  untilDrawn,
} from './support.ts';

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
    ...((await bar.getByTestId('orders-waiting').count())
      ? [await box('the orders waiting', bar.getByTestId('orders-waiting'))]
      : []),
    await box('Overview', bar.getByRole('button', { name: 'Overview' })),
    await box('Game', bar.getByRole('button', { name: 'Game', exact: true })),
  ];
}

async function startScreenItem(page: Page) {
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start screen' }).click();
  return page.getByTestId('leave-confirm');
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

    test('keeps one row with two stores run out and an order waiting, and says so on each', async ({
      page,
    }) => {
      await openGame(page);
      await load(page, storesRunOut());
      const view = camera(page);
      const banner = view.banner(cityPoint('roma'));
      await page.mouse.click(banner.x, banner.y);
      await page.getByTestId('army-panel').waitFor();
      const capua = view.city('capua');
      await page.mouse.click(capua.x, capua.y, { button: 'right' });
      const bar = page.getByTestId('top-bar');
      await expect(bar.getByTestId('orders-waiting')).toHaveAttribute(
        'title',
        '1 army has orders for the next day',
      );
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

/** The box of `item` inside the window and inside `room`, which clips it, once scrolled to. */
async function readWhole(page: Page, room: Locator, item: Locator, what: string) {
  await item.scrollIntoViewIfNeeded();
  const line = await box(what, item);
  const clip = await box(`what holds ${what}`, room);
  const window = page.viewportSize();
  if (!window) throw new Error('no window');
  expect(line.y, `${what} starts inside what holds it`).toBeGreaterThanOrEqual(clip.y - 0.5);
  expect(line.y + line.height, `${what} ends inside what holds it`).toBeLessThanOrEqual(
    clip.y + clip.height + 0.5,
  );
  expect(line.y + line.height, `${what} ends inside the window`).toBeLessThanOrEqual(window.height);
}

test.describe('the corner at 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const { name, save, line } of [
    {
      name: 'the longest line the game tells, a climb that stops the game with guards that stop counting',
      save: () => carthageClimbs(8, 2),
      line: /no longer count against Carthage's war\. Carthage stands higher/,
    },
    {
      name: 'a line that runs the game on, guards that stop counting',
      save: () => carthageClimbs(0, 2),
      line: /no longer count against Carthage's war: it stands/,
    },
  ])
    test(`reads ${name} whole, with the Chronicle shut and open`, async ({ page }) => {
      await openGame(page, { pauses: true });
      await pause(page);
      await dropSave(page, save());
      await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
      await untilDrawn(page);
      await resume(page);
      const corner = page.getByTestId('alerts');
      const told = corner.getByRole('listitem').filter({ hasText: line }).first();
      await told.waitFor();
      await pause(page);
      const window = await box('the window', page.locator('.hud'));
      const list = await box('the corner', corner);
      expect(list.y + list.height, 'the corner ends inside the window').toBeLessThanOrEqual(
        window.y + window.height,
      );
      await corner.evaluate((el) => el.scrollTo(0, 0));
      await readWhole(
        page,
        corner,
        corner.getByRole('listitem').first(),
        'the newest line in the corner',
      );

      await page.getByRole('button', { name: 'Chronicle' }).click();
      const chronicle = page.getByTestId('chronicle');
      await expect(chronicle).toBeVisible();
      await expect(corner, 'the corner gives way to the open Chronicle').toBeHidden();
      await readWhole(
        page,
        chronicle.getByRole('list'),
        chronicle.getByRole('listitem').filter({ hasText: line }).first(),
        'the line in the Chronicle',
      );
      await expect(page.getByRole('button', { name: 'Chronicle' })).toBeInViewport();
    });
});

test.describe('the corner at 1280 × 720 with older news', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('scrolls up to a line that stops the game when the player had scrolled the corner down', async ({
    page,
  }) => {
    const older = Array.from({ length: 6 }, (_, i) => ({
      kind: 'buildingWorthGold' as const,
      day: (90 + i) as Day,
      tone: 'neutral' as const,
      text: `Older news of day ${90 + i}, long enough to take three or four lines of the corner, so that the corner holds more than it shows and scrolls.`,
    }));
    await openGame(page, { pauses: true });
    await pause(page);
    await dropSave(page, carthageClimbs(8, 2, older.reverse()));
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
    await untilDrawn(page);
    const corner = page.getByTestId('alerts');
    await corner.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await corner.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await resume(page);
    const stopped = corner
      .getByRole('listitem')
      .filter({ has: page.getByTestId('alert-paused') })
      .first();
    await stopped.waitFor();
    await untilDrawn(page);
    const line = await box('the stopped line', stopped);
    const room = await box('the corner', corner);
    expect(line.y, 'the stopped line starts inside the corner').toBeGreaterThanOrEqual(
      room.y - 0.5,
    );
    expect(line.y + line.height, 'the stopped line ends inside the corner').toBeLessThanOrEqual(
      room.y + room.height + 0.5,
    );
  });
});

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

test.describe('leaving for the start screen', () => {
  test('asks first, pauses while it asks, and Stay runs the game on', async ({ page }) => {
    await openGame(page);
    await expect(page.getByTestId('time-controls-speed')).not.toHaveText('Paused');
    const confirm = await startScreenItem(page);
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('start-screen')).toHaveCount(0);
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    const asked = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));

    await confirm.getByRole('button', { name: 'Stay' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('time-controls-speed')).not.toHaveText('Paused');
    await untilDay(page, asked + 1);
  });

  test('Stay keeps a paused game paused', async ({ page }) => {
    await openGame(page);
    await pause(page);
    const confirm = await startScreenItem(page);
    await confirm.getByRole('button', { name: 'Stay' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
  });

  test('Save and leave writes your save, and Continue loads it', async ({ page }) => {
    await openGame(page);
    await untilDay(page, 3);
    const confirm = await startScreenItem(page);
    const saved = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
    await confirm.getByRole('button', { name: 'Save and leave' }).click();
    const start = page.getByTestId('start-screen');
    await expect(start.getByTestId('continue-info')).toHaveText(`Rome, Year 1, day ${saved}`);
    await start.getByRole('button', { name: 'Continue' }).click();
    await expect(start).toHaveCount(0);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', String(saved));
  });

  test('Leave without saving writes nothing', async ({ page }) => {
    await openGame(page);
    await resume(page);
    const confirm = await startScreenItem(page);
    await confirm.getByRole('button', { name: 'Leave without saving' }).click();
    const start = page.getByTestId('start-screen');
    await expect(start).toBeVisible();
    await expect(start.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  });
});
