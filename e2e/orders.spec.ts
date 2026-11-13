import { expect, test, type Page } from '@playwright/test';
import type { CityId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  dropSave,
  openGame,
  pause,
  resume,
  rome,
  startGame,
  untilDrawn,
} from './support.ts';

type View = ReturnType<typeof camera>;

/** Screen offsets of a right click from a city's icon: on it, and 8 px off along each axis. */
const OFFSETS = [
  [0, 0],
  [8, 0],
  [-8, 0],
  [0, 8],
  [0, -8],
] as const;

/** Land that a march from Roma reaches, far from every city's icon on the opening view. */
const SCATTERED: MapPoint[] = [
  { x: 2474.4, y: 1011.1 },
  { x: 3232.7, y: 1011.1 },
  { x: 3081, y: 1162.8 },
  { x: 1564.4, y: 1314.4 },
  { x: 3232.7, y: 1314.4 },
  { x: 3991, y: 1314.4 },
  { x: 3384.4, y: 1466.1 },
  { x: 4142.7, y: 1466.1 },
  { x: 3536, y: 1617.8 },
  { x: 4294.4, y: 1617.8 },
  { x: 3687.7, y: 1769.4 },
  { x: 2777.7, y: 1921.1 },
  { x: 5204.4, y: 1921.1 },
  { x: 4597.7, y: 2072.8 },
  { x: 3536, y: 2224.4 },
  { x: 4597.7, y: 2527.8 },
  { x: 5356, y: 2831.1 },
  { x: 1564.4, y: 3134.4 },
  { x: 1564.4, y: 3286.1 },
];

async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** Selects Rome's army where a new game starts it. The selection outlasts a loaded save. */
async function selectRomanArmy(page: Page, view: View) {
  const flag = view.banner(cityPoint('roma'));
  await page.mouse.click(flag.x, flag.y);
  await expect(page.getByTestId('army-activity')).toHaveText('Idle at Roma');
}

/**
 * Rome's army stands idle on land 25 km east of the city, a day's march away. The city
 * has no army, and every other army is weeks away.
 */
function armyBeside(id: string, { war }: { war: boolean }): GameState {
  const state = startGame();
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no city ${id}`);
  if (war) declareWar(state, rome, city.owner);
  armyOf(state, rome).activity = {
    kind: 'idle',
    position: { x: city.position.x + 25, y: city.position.y },
  };
  return state;
}

async function rightClick(page: Page, at: MapPoint) {
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

test.describe('orders by right click', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await openGame(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  for (const [id, name] of [
    ['massalia', 'Massalia'],
    ['mediolanum', 'Mediolanum'],
  ] as const) {
    for (const [notches, zoom] of [
      [0, 'at the opening zoom'],
      [6, 'zoomed in'],
    ] as const) {
      for (const [dx, dy] of OFFSETS) {
        test(`a right click ${dx}, ${dy} px off the icon of ${name}, an enemy, ${zoom}, besieges it`, async ({
          page,
        }) => {
          const view = camera(page);
          const activity = page.getByTestId('army-activity');
          await selectRomanArmy(page, view);
          await pause(page);
          if (notches > 0) await view.zoom(view.city(id), notches);
          await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
          await load(page, armyBeside(id, { war: true }));
          await expect(activity).toHaveText(`Idle near ${name}`);
          const icon = view.city(id);
          await rightClick(page, { x: icon.x + dx, y: icon.y + dy });
          await resume(page);
          await expect(activity).toHaveText(new RegExp(`^Besieging ${name} · day \\d+$`));
          await expect(page.getByTestId('notice')).toHaveCount(0);
        });
      }
    }
  }

  test('a right click on a city at peace marches there and says that a siege needs a war', async ({
    page,
  }) => {
    const view = camera(page);
    const activity = page.getByTestId('army-activity');
    await selectRomanArmy(page, view);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await pause(page);
    await load(page, armyBeside('massalia', { war: false }));
    await rightClick(page, view.city('massalia'));
    await expect(page.getByTestId('notice')).toHaveText(
      'At peace with Massalia. Declare war to besiege it.',
    );
    await resume(page);
    await expect(activity).toHaveText('Idle at Massalia');
  });

  test('a right click exactly on the icon of a coastal city marches there with no refusal', async ({
    page,
  }) => {
    const view = camera(page);
    const activity = page.getByTestId('army-activity');
    await selectRomanArmy(page, view);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await pause(page);
    await load(page, armyBeside('massalia', { war: true }));
    await rightClick(page, view.city('massalia'));
    await resume(page);
    await expect(activity).toHaveText(/^Besieging Massalia · day \d+$/);
    await expect(page.getByTestId('notice')).toHaveCount(0);
  });

  test('twenty right clicks in a pause leave one order for the army, which marches to the last place', async ({
    page,
  }) => {
    const view = camera(page);
    await selectRomanArmy(page, view);
    await pause(page);
    for (const point of SCATTERED) await rightClick(page, view.screen(point));
    await rightClick(page, view.city('capua'));
    await expect(page.getByTestId('orders-waiting')).toHaveAttribute(
      'title',
      '1 army has orders for the next day',
    );
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^Marching to Capua · \d+ days? left$/,
    );
  });

  test('from Roma a right click on Caralis, an island port, offers only the crossing by sea', async ({
    page,
  }) => {
    const view = camera(page);
    await selectRomanArmy(page, view);
    await pause(page);
    await rightClick(page, view.city('caralis'));
    const menu = page.getByRole('menu', { name: 'Orders for Caralis' });
    await expect(menu.getByRole('group', { name: 'By sea' }).getByRole('menuitem')).toHaveText([
      /^Sail from Roma to Caralis\s*\d+ days? by sea$/,
    ]);
    await expect(menu.getByRole('group', { name: 'By land' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /March/ })).toHaveCount(0);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^At sea (to|toward) Caralis · \d+ days? left$/,
    );
  });

  test('from Roma a right click on Massalia offers the sea and the land, each with its days', async ({
    page,
  }) => {
    const view = camera(page);
    await selectRomanArmy(page, view);
    await pause(page);
    await rightClick(page, view.city('massalia'));
    const menu = page.getByRole('menu', { name: 'Orders for Massalia' });
    await expect(menu.getByRole('group', { name: 'By sea' }).getByRole('menuitem')).toHaveText([
      /^Sail from Roma to Massalia\s*\d+ days? by sea$/,
    ]);
    await expect(menu.getByRole('group', { name: 'By land' }).getByRole('menuitem')).toHaveText([
      /^March to Massalia\s*\d+ days?$/,
    ]);

    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: /^March to Massalia/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^Marching to Massalia · \d+ days? left$/,
    );
  });

  test('the port menu stays inside the window when the city is at its bottom edge', async ({
    page,
  }) => {
    const view = camera(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    await selectRomanArmy(page, view);
    await pause(page);
    const caralis = view.city('caralis');
    await view.zoom({ x: caralis.x, y: caralis.y - 125 }, 6);
    const edge = view.city('caralis');
    expect(edge.y, 'Caralis sits at the bottom edge').toBeGreaterThan(viewport.height - 30);
    expect(edge.y).toBeLessThan(viewport.height);
    await rightClick(page, edge);
    await expect(page.getByRole('menu', { name: 'Orders for Caralis' })).toBeInViewport({
      ratio: 1,
    });
  });
});

test.describe('orders across the sea', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await openGame(page, { power: 'carthage' });
    const view = camera(page);
    const flag = view.banner(cityPoint('carthago'));
    await page.mouse.click(flag.x, flag.y);
    await expect(page.getByTestId('army-activity')).toHaveText('Idle at Carthago');
    await pause(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('as Carthage a right click on Capua, across the sea and no port, offers the crossing to the port nearest it and no march round the sea', async ({
    page,
  }) => {
    await rightClick(page, camera(page).city('capua'));
    const menu = page.getByRole('menu', { name: 'Orders for Capua' });
    await expect(menu.getByRole('group', { name: 'By sea' }).getByRole('menuitem')).toHaveText([
      /^Sail from Carthago to Roma\s*\d+ days by sea, then \d+ days? by land$/,
    ]);
    await expect(menu.getByRole('group', { name: 'By land' })).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^At sea (to|toward) Roma · \d+ days? left, then marching to Capua · \d+ days? left$/,
    );
  });

  test('as Carthage a right click on Roma, a port, offers only the crossing and not the march round the sea', async ({
    page,
  }) => {
    await rightClick(page, camera(page).city('roma'));
    const menu = page.getByRole('menu', { name: 'Orders for Roma' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^Sail from Carthago to Roma\s*\d+ days by sea, then 1 day by land$/,
      'Cancel',
    ]);
    await expect(menu.getByRole('menuitem', { name: /March/ })).toHaveCount(0);
  });

  test.describe('at a wider view', () => {
    // At 1280 px the army panel covers the far east of the widest zoom, where the city lies.
    test.use({ viewport: { width: 1600, height: 900 } });

    test('a right click on a city that neither a march nor a crossing reaches says why in words', async ({
      page,
    }) => {
      await rightClick(page, camera(page).city('alexandria-arachosion'));
      await expect(page.getByTestId('notice')).toHaveText(
        /^Order refused\. The march to Alexandria Arachosion takes \d+ days, more than the 90 a march may take\. No way by sea lands within 90 days' march of it\.$/,
      );
      await expect(page.getByTestId('command-menu')).toHaveCount(0);
      await expect(page.getByTestId('orders-waiting')).toHaveCount(0);
    });
  });
});
