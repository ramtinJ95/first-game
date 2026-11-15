import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  camera,
  carthage,
  cityPoint,
  declareWar,
  dropSave,
  openGame,
  pause,
  playDays,
  resizeTo,
  resume,
  rome,
  startGame,
  untilDrawn,
  withFormations,
} from '../../../e2e/support.ts';
import type { CityId, FactionId } from '../../../src/sim/ids.ts';
import type { Order } from '../../../src/sim/orders/orders.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { routePoint } from '../../../src/sim/trade/routes.ts';
import { defineScenario } from '../scenario.ts';

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

const open = (from: string, to: string, mode: 'land' | 'sea', faction = rome): Order => ({
  kind: 'openTrade',
  faction,
  from: from as CityId,
  to: to as CityId,
  mode,
});

function rich(gold = 10000) {
  const state = startGame();
  for (const id of [rome, carthage]) {
    const faction = state.factions[id];
    if (faction) faction.stores.gold = gold;
  }
  return state;
}

export default defineScenario({
  name: 'trade-told',
  title:
    'What trade tells before it is done: the risk beside the payback, the partner list, the routes a war closes, Close route, an invitation, the gathered news, and the list on a phone',
  async run({ page, shot }) {
    await openGame(page);

    const syracusaeAtWar = rich();
    declareWar(syracusaeAtWar, carthage, 'syracusae' as FactionId);
    await load(page, syracusaeAtWar);
    await openCity(page, 'roma', 'Roma');
    const partners = page.getByTestId('trade-partners');
    await partners.getByRole('button', { name: /^Syracusae by sea/ }).click();
    await page.getByTestId('trade-payback').scrollIntoViewIfNeeded();
    await shot(
      'quote-risk',
      'A quote for Roma to Syracusae: the payback set against Syracusae’s war with Carthage, which closes the route if Syracusae falls',
    );
    await partners.evaluate((list) => {
      list.scrollTop = 0;
      list.previousElementSibling?.previousElementSibling?.scrollIntoView({ block: 'start' });
    });
    await shot(
      'picker',
      'The partner list: cities that agree now with their way, payback, price and risk, then the rest with the reason',
    );

    const trading = playDays(rich(), 24, [
      open('roma', 'carthago', 'sea'),
      open('roma', 'capua', 'land'),
    ]);
    await load(page, trading);
    await openCity(page, 'carthago', 'Carthago');
    await page.getByRole('button', { name: 'Declare war on Carthage', exact: true }).click();
    await page.getByTestId('war-trade').scrollIntoViewIfNeeded();
    await shot(
      'war-routes',
      'Declare war on Carthage? The route it closes with its price, what it has brought, and what is still unpaid, and the roads it exposes',
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await openCity(page, 'roma', 'Roma');
    await page.getByRole('button', { name: 'Close route', exact: true }).first().click();
    await page.getByTestId('trade-close-confirm').scrollIntoViewIfNeeded();
    await shot(
      'close-route',
      'Close route asks first: what the route cost, what it has brought and what is unpaid, no refund, and the price to open it again',
    );
    await page.getByRole('button', { name: 'Keep route', exact: true }).click();
    await page.getByTestId('trade-improve').first().scrollIntoViewIfNeeded();
    await shot(
      'improve-route',
      'With the slots full, a running route can be improved twice: half its opening price for a quarter more gold a day at both ends, with its payback and no refund on closing',
    );

    const invited = playDays(rich(), 1, [
      open('carthago', 'roma', 'sea', carthage),
      open('roma', 'capua', 'land'),
      open('roma', 'arretium', 'land'),
      open('roma', 'mediolanum', 'land'),
    ]);
    await load(page, invited);
    await openCity(page, 'roma', 'Roma');
    await page.getByTestId('trade-invitation').scrollIntoViewIfNeeded();
    await shot(
      'invitation',
      'An invitation: both goods, the way and its crossing, what each arrival pays Roma, the last day, and Accept disabled with its reason',
    );

    const troubled = playDays(rich(), 1, [
      open('roma', 'capua', 'land'),
      open('roma', 'syracusae', 'sea'),
      open('roma', 'arretium', 'land'),
    ]);
    const macedon = 'macedon' as FactionId;
    declareWar(troubled, carthage, 'syracusae' as FactionId);
    declareWar(troubled, rome, macedon);
    const punic = withFormations(troubled, armyOf(troubled, carthage), [
      ['spearmen', 3000],
      ['swordsmen', 2000],
    ]);
    punic.activity = { kind: 'idle', position: cityPoint('syracusae') };
    armyOf(troubled, rome).activity = { kind: 'idle', position: cityPoint('mediolanum') };
    const road = Object.values(troubled.tradeRoutes).find((r) => r.to === 'capua');
    if (!road) throw new Error('expected the road to Capua');
    armyOf(troubled, macedon).activity = { kind: 'idle', position: routePoint(road, 0.5) };
    await load(page, troubled);
    await resume(page);
    const alerts = page.getByTestId('alerts');
    await alerts.getByText(/The siege of Syracusae stops trade: Roma to Syracusae\./).waitFor();
    await alerts.getByText(/Macedon raided the road Roma to Capua/).waitFor();
    await pause(page);
    await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
    const chronicle = page.getByTestId('chronicle');
    await expect(chronicle).toContainText('The siege of Syracusae stops trade');
    await shot(
      'news',
      'The news of trade: Carthage’s siege of Syracusae stops the route, which would close only if Syracusae fell to a power at war with Rome, and Macedon’s raid is one line with its loss',
    );

    await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
    await load(page, syracusaeAtWar);
    await openCity(page, 'roma', 'Roma');
    await resizeTo(page, { width: 390, height: 844 });
    await partners.scrollIntoViewIfNeeded();
    await shot('picker-phone', 'The partner list at 390 px wide, within reach in the bottom sheet');
  },
});
