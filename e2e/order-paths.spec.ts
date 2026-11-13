import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import {
  armyOf,
  beatenNearHadrumetum,
  camera,
  cityPoint,
  dropSave,
  idleBesideEnemyCity,
  openGame,
  pause,
  resume,
  rome,
  untilDrawn,
} from './support.ts';

/** At speed 3 the page plays five days a second, so a voyage of 45 days takes about 9 s. */
const VOYAGE_MS = 30_000;

async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

async function selectArmyAt(page: Page, at: MapPoint) {
  const flag = camera(page).banner(at);
  await page.mouse.click(flag.x, flag.y);
  await expect(page.getByTestId('army-panel')).toBeVisible();
}

async function fastest(page: Page) {
  await page.getByRole('button', { name: 'Speed 3' }).click();
  await resume(page);
}

function positionOf(state: GameState): MapPoint {
  const { activity } = armyOf(state, rome);
  if (activity.kind !== 'idle') throw new Error(`the Roman army is ${activity.kind}`);
  return activity.position;
}

test.describe('orders that finish', () => {
  const errors: string[] = [];

  test.beforeEach(({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('a Roman army beaten at Carthago, in the field near Hadrumetum, gathers ships on the shore and sails home to Roma', async ({
    page,
  }) => {
    await openGame(page);
    await pause(page);
    const state = beatenNearHadrumetum();
    await load(page, state);
    await selectArmyAt(page, positionOf(state));
    await expect(page.getByTestId('army-activity')).toHaveText('Idle near Hadrumetum');

    const roma = camera(page).city('roma');
    await page.mouse.click(roma.x, roma.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Orders for Roma' });
    await expect(menu.getByRole('group', { name: 'By sea' }).getByRole('menuitem')).toHaveText([
      /^Sail from the shore near Hadrumetum to Roma\s*10 days to gather ships, then \d+ days by sea, then 1 day by land$/,
    ]);
    await menu.getByRole('menuitem', { name: /^Sail from the shore/ }).click();
    await expect(page.getByTestId('notice')).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^Gathering ships near Hadrumetum · \d+ days?, then sailing toward Roma · \d+ days? left, then marching to Roma · 1 day left$/,
    );
    await fastest(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^At sea toward Roma · \d+ days? left, then marching to Roma · 1 day left$/,
      { timeout: VOYAGE_MS },
    );
    await expect(page.getByTestId('army-activity')).toHaveText('Idle at Roma', {
      timeout: VOYAGE_MS,
    });
  });

  test('as Carthage the crossing to Roma for Capua lands the army and marches it on to Capua, and the panel says so on both legs', async ({
    page,
  }) => {
    await openGame(page, { power: 'carthage' });
    const view = camera(page);
    const flag = view.banner(cityPoint('carthago'));
    await page.mouse.click(flag.x, flag.y);
    await expect(page.getByTestId('army-activity')).toHaveText('Idle at Carthago');
    await pause(page);

    const capua = view.city('capua');
    await page.mouse.click(capua.x, capua.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Orders for Capua' });
    await expect(menu.getByRole('group', { name: 'By sea' }).getByRole('menuitem')).toHaveText([
      /^Sail from Carthago to Roma\s*\d+ days by sea, then \d+ days? by land$/,
    ]);
    await page.keyboard.press('Enter');
    await fastest(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^At sea (to|toward) Roma · \d+ days? left, then marching to Capua · \d+ days? left$/,
    );
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^Marching to Capua · \d+ days? left$/,
      { timeout: VOYAGE_MS },
    );
    await expect(page.getByTestId('army-activity')).toHaveText(/^(Idle at|Besieging) Capua/, {
      timeout: VOYAGE_MS,
    });
  });

  test('an idle army beside an enemy city says why it does not besiege it, and one click on Besiege besieges it', async ({
    page,
  }) => {
    await openGame(page);
    await pause(page);
    const state = idleBesideEnemyCity('mediolanum');
    await load(page, state);
    await selectArmyAt(page, positionOf(state));
    await expect(page.getByTestId('army-siege-block')).toHaveText(
      'Stands 15 km from Mediolanum, too far to besiege it. An army besieges a city it stands within 10 km of.',
    );
    await page.getByTestId('army-besiege').click();
    await expect(page.getByTestId('army-besiege')).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(/^Besieging Mediolanum · day \d+$/);
  });
});
