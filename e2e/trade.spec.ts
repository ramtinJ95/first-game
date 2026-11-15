import { expect, test, type Page } from '@playwright/test';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  camera,
  cityPoint,
  day,
  dropSave,
  openGame,
  pause,
  playDays,
  resizeTo,
  resume,
  rome,
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
const open = (to: string, mode: 'land' | 'sea'): Order => ({
  kind: 'openTrade',
  faction: 'rome' as FactionId,
  from: 'roma' as CityId,
  to: to as CityId,
  mode,
});
function richRome(gold = 5000) {
  const state = startGame();
  const faction = state.factions[state.player];
  if (!faction) throw new Error('Rome is missing');
  faction.stores.gold = gold;
  return state;
}

test('opens a route through the page, watches delivery and gold, and loads a caravan in transit', async ({
  page,
}) => {
  await openGame(page);
  const state = richRome();
  await load(page, state);
  await openCity(page, 'roma', 'Roma');
  await page
    .getByTestId('trade-partners')
    .getByRole('button', { name: /^Capua by land/ })
    .click();
  await expect(page.getByTestId('trade-forecast')).toContainText('km by land');
  await expect(page.getByTestId('trade-consent')).toContainText('Both ends are yours');
  await expect(page.getByTestId('trade-payment-timing')).toContainText('paid when the clock runs');
  await page
    .getByRole('button', { name: 'Open trade route to Capua by land', exact: true })
    .click();
  expect(await amount(page)).toBe(5000);
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

  const saved = playDays(state, 3, [open('capua', 'land')]);
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

test('declaring war through the page names the route it closes, then closes it and tells the player', async ({
  page,
}) => {
  await openGame(page);
  const saved = playDays(richRome(), 1, [open('carthago', 'sea')]);
  const route = Object.values(saved.tradeRoutes)[0];
  if (!route) throw new Error('expected a saved sea route');
  await load(page, saved);
  await openCity(page, 'carthago', 'Carthago');
  await expect(page.getByTestId('trade-routes')).toContainText('Roma');
  await page.getByRole('button', { name: 'Declare war on Carthage', exact: true }).click();
  const cost = route.cost.toLocaleString('en');
  const lines = page.getByTestId('war-trade');
  await expect(lines).toContainText(
    `It closes Roma to Carthago by sea: cost ${cost} gold, brought 0 gold, ${cost} still unpaid.`,
  );
  await page.getByRole('button', { name: 'Confirm war', exact: true }).click();
  await resume(page);
  await expect(page.getByTestId('alerts')).toContainText(
    'Trade closed: Roma to Carthago, war between the partners',
  );
  await pause(page);
  await expect(page.getByTestId('trade-routes')).not.toContainText('Roma');
});

test('Close route asks first, with what the route cost and earned and that there is no refund', async ({
  page,
}) => {
  await openGame(page);
  const saved = playDays(richRome(), 14, [open('capua', 'land')]);
  const route = Object.values(saved.tradeRoutes)[0];
  if (!route || route.deliveries < 1) throw new Error('expected a route that has delivered');
  await load(page, saved);
  await openCity(page, 'roma', 'Roma');
  await page.getByRole('button', { name: 'Close route', exact: true }).click();
  const confirm = page.getByTestId('trade-close-confirm');
  await expect(confirm).toContainText(
    `Close Roma to Capua by land? It cost ${route.cost.toLocaleString('en')} gold, brought ${Math.round(route.receipts[rome] ?? 0).toLocaleString('en')} gold`,
  );
  await expect(confirm).toContainText(
    'Closing gives no refund, and opening it again costs the full price',
  );
  await page.getByRole('button', { name: 'Keep route', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId('trade-routes')).toContainText('Capua');
  await page.getByRole('button', { name: 'Close route', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm close', exact: true }).click();
  await resume(page);
  await expect(page.getByTestId('alerts')).toContainText(
    'Trade closed: Roma to Capua, closed by Rome.',
  );
  await pause(page);
  await expect(page.getByTestId('trade-routes')).not.toContainText('Capua');
});

test('an invitation tells its terms, cannot be accepted without a free slot, and its refusal is news', async ({
  page,
}) => {
  await openGame(page);
  const state = richRome(10000);
  const carthage = state.factions['carthage' as FactionId];
  if (!carthage) throw new Error('Carthage is missing');
  carthage.stores.gold = 5000;
  const invite: Order = {
    kind: 'openTrade',
    faction: 'carthage' as FactionId,
    from: 'carthago' as CityId,
    to: 'roma' as CityId,
    mode: 'sea',
  };
  const saved = playDays(state, 1, [
    invite,
    open('capua', 'land'),
    open('arretium', 'land'),
    open('mediolanum', 'land'),
  ]);
  const offer = Object.values(saved.tradeRoutes).find((r) => r.status === 'offered');
  if (!offer) throw new Error('expected an invitation');
  await load(page, saved);
  await openCity(page, 'roma', 'Roma');
  const terms = page.getByTestId('trade-invitation');
  const carthago = saved.cities['carthago' as CityId];
  const good = carthago && saved.provinces[carthago.province]?.good;
  await expect(terms).toContainText(`Carthago (${good ?? ''}) invites Roma`);
  await expect(terms).toContainText(
    `by sea, ${offer.days} days a crossing. Each arrival pays Roma`,
  );
  await expect(terms).toContainText('It expires on Year 1, day 91');
  const accept = page.getByRole('button', { name: 'Accept trade', exact: true });
  await expect(accept).toBeDisabled();
  await expect(page.getByTestId('trade-accept-refusal')).toHaveText(
    'You cannot accept: Roma has no free route slot.',
  );
  await page.getByRole('button', { name: 'Refuse trade', exact: true }).click();
  await resume(page);
  await expect(page.getByTestId('alerts')).toContainText(
    'Invitation to trade ended: Carthago to Roma, refused by Rome.',
  );
  await pause(page);
  await expect(page.getByTestId('trade-invitation')).toHaveCount(0);
});

test('the partner list leads with cities that agree, says why the rest would not, and fits a phone', async ({
  page,
}) => {
  await openGame(page);
  await load(page, richRome());
  await openCity(page, 'roma', 'Roma');
  const partners = page.getByTestId('trade-partners');
  await expect(partners.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(partners).toContainText('Would not agree now');
  await expect(partners).toContainText(
    'No land road within 1,000 km, and no sea lane within 1,800 km',
  );
  await partners.getByRole('button', { name: /^Carthago by sea/ }).click();
  await expect(page.getByTestId('trade-forecast')).toContainText('km by sea');
  await expect(page.getByTestId('trade-payback')).toContainText('pays back in');

  await resizeTo(page, { width: 390, height: 844 });
  await partners.scrollIntoViewIfNeeded();
  await expect(partners).toBeInViewport();
  const box = await partners.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await partners.getByRole('button', { name: /^Capua by land/ }).click();
  await expect(page.getByTestId('trade-forecast')).toContainText('km by land');
  const openButton = page.getByRole('button', {
    name: 'Open trade route to Capua by land',
    exact: true,
  });
  await openButton.scrollIntoViewIfNeeded();
  await expect(openButton).toBeInViewport();
});

test('a running route offers its improvement with price and payback, and an improved route earns more', async ({
  page,
}) => {
  await openGame(page);
  const saved = playDays(richRome(), 2, [open('capua', 'land')]);
  const route = Object.values(saved.tradeRoutes)[0];
  if (!route) throw new Error('expected a running route');
  await load(page, saved);
  await openCity(page, 'roma', 'Roma');
  const offer = page.getByTestId('trade-improve');
  const price = Math.ceil(route.cost / 2);
  const gain = route.daily * 0.25 * 2;
  await expect(offer).toContainText(`Improve for ${price.toLocaleString('en')} gold`);
  await expect(offer).toContainText(
    `+${gain.toFixed(1)} gold a day to your realm, from both ends, repaid in ${(price / gain / 365).toFixed(1)} years.`,
  );
  await expect(offer).toContainText('Improved 0 of 2 times; no refund on closing.');
  const gold = saved.factions[rome]?.stores.gold ?? 0;
  await page.getByRole('button', { name: 'Improve route', exact: true }).click();
  await resume(page);
  await untilDay(page, saved.day + 1);
  await pause(page);
  await expect(offer).toContainText('Improved 1 of 2 times');
  const paid = Number((await page.getByTestId('store-gold-amount').innerText()).replace(/,/g, ''));
  expect(paid).toBeLessThanOrEqual(gold - price + 100);
  expect(paid).toBeLessThan(gold);
  await expect(offer).toContainText(`Improve for ${price.toLocaleString('en')} gold`);
});
