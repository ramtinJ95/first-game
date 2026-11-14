import { expect, test, type Page } from '@playwright/test';
import type { CityId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  camera,
  cityPoint,
  day,
  dropSave,
  openGame,
  pause,
  playDays,
  resume,
  startGame,
  untilDay,
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
async function openCity(page: Page, id: string, name: string) {
  const at = cityPoint(id);
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText(name);
}
const amount = async (page: Page) =>
  Number((await page.getByTestId('store-gold-amount').textContent())?.replaceAll(',', ''));

test('opens a route through the page, watches delivery and gold, and loads a caravan in transit', async ({
  page,
}) => {
  await openGame(page);
  const state = startGame();
  const faction = state.factions[state.player];
  if (!faction) throw new Error('Rome is missing');
  faction.stores.gold = 5000;
  await load(page, state);
  await openCity(page, 'roma', 'Roma');
  await page.getByLabel('Trade destination', { exact: true }).selectOption('capua');
  await page.getByLabel('Trade transport').selectOption('land');
  await expect(page.getByTestId('trade-forecast')).toContainText('km by land');
  await expect(page.getByTestId('trade-consent')).toContainText('Both ends are yours');
  await page.getByRole('button', { name: 'Open trade route', exact: true }).click();
  await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
  await resume(page);
  await expect(page.getByTestId('alerts')).toContainText('Trade opened: Roma to Capua');
  await pause(page);
  const paid = await amount(page);
  expect(paid).toBeLessThan(5000);
  await resume(page);
  await expect(page.getByTestId('trade-deliveries').first()).not.toHaveText('0 deliveries');
  await pause(page);
  expect(await amount(page)).toBeGreaterThan(paid);

  const saved = playDays(state, 3, [
    {
      kind: 'openTrade',
      faction: state.player,
      from: 'roma' as CityId,
      to: 'capua' as CityId,
      mode: 'land',
    },
  ]);
  const route = Object.values(saved.tradeRoutes)[0];
  if (!route || route.progress <= 0) throw new Error('expected a caravan in transit');
  await load(page, saved);
  await openCity(page, 'roma', 'Roma');
  await expect(page.getByTestId('trade-routes')).toContainText('Capua');
  await expect(page.getByTestId('trade-deliveries')).toHaveText('0 deliveries');
  await resume(page);
  await untilDay(page, (await day(page)) + route.days);
  await expect(page.getByTestId('trade-deliveries').first()).not.toHaveText('0 deliveries');
});

test('declaring war through the page closes a saved sea route and tells the player', async ({
  page,
}) => {
  await openGame(page);
  const state = startGame();
  const faction = state.factions[state.player];
  if (!faction) throw new Error('Rome is missing');
  faction.stores.gold = 5000;
  const saved = playDays(state, 1, [
    {
      kind: 'openTrade',
      faction: state.player,
      from: 'roma' as CityId,
      to: 'carthago' as CityId,
      mode: 'sea',
    },
  ]);
  if (!Object.values(saved.tradeRoutes).length) throw new Error('expected a saved sea route');
  await load(page, saved);
  await openCity(page, 'carthago', 'Carthago');
  await expect(page.getByTestId('trade-routes')).toContainText('Roma');
  await page.getByRole('button', { name: 'Declare war on Carthage', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm war', exact: true }).click();
  await resume(page);
  await expect(page.getByTestId('alerts')).toContainText(
    'Trade closed: Roma to Carthago, war between the partners',
  );
  await pause(page);
  await expect(page.getByTestId('trade-routes')).not.toContainText('Roma');
});
