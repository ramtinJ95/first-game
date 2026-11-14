import type { Page } from '@playwright/test';
import {
  beatenOverseas,
  camera,
  cityPoint,
  openGame,
  pause,
  playDays,
} from '../../../e2e/support.ts';
import type { PowerId } from '../../../src/sim/map.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

/** Selects the player's army on its flag at the point and waits for its panel. */
async function selectArmy(page: Page, point: MapPoint, activity: RegExp | string) {
  const view = camera(page);
  await view.jumpTo(point, 0.5);
  const flag = view.banner(point);
  await page.mouse.click(flag.x, flag.y);
  await page.getByTestId('army-activity').filter({ hasText: activity }).waitFor();
  return view;
}

async function beaten(page: Page, power: PowerId, enemy: PowerId, at: string) {
  await openGame(page, { power });
  await pause(page);
  // A day on, the beaten army stands clear of the winner's banner.
  const state = playDays(beatenOverseas(power, enemy, at), 1);
  await loadSave(page, state);
  const army = Object.values(state.armies).find(
    (a) => a.owner === power && a.activity.kind === 'retreating',
  );
  if (army?.activity.kind !== 'retreating') throw new Error(`no army of ${power} retreats`);
  // A retreat can pass behind a city's symbol at a wide zoom; Overview reaches the
  // force without clicking through the city that now wins that overlapping hit.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page
    .getByTestId('overview-armies')
    .getByRole('button')
    .filter({ hasText: army.name })
    .click();
  await page
    .getByTestId('army-activity')
    .filter({ hasText: /^(Retreating to|Falling back into the field)/ })
    .waitFor();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
}

export default defineScenario({
  name: 'sea-orders',
  title:
    'A beaten army overseas falls back into the field, a right click across the sea offers the crossing, and the port menu offers no march round the sea',
  async run({ page, shot }) {
    await beaten(page, 'rome', 'carthage', 'hadrumetum');
    await shot(
      'rome-beaten-at-hadrumetum',
      'Rome beaten at Hadrumetum while it holds Capua: the army falls back into the field, a few days away',
    );
    await beaten(page, 'carthage', 'rome', 'roma');
    await shot(
      'carthage-beaten-at-roma',
      'Carthage beaten at Roma while it holds Carthago: the army falls back into the field, a few days away',
    );

    await openGame(page, { power: 'carthage' });
    await pause(page);
    const view = await selectArmy(page, cityPoint('carthago'), 'Idle at Carthago');
    const capua = view.city('capua');
    await page.mouse.click(capua.x, capua.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Orders for Capua' }).waitFor();
    await shot(
      'capua-as-carthage',
      'As Carthage a right click on Capua, which is not a port, offers the crossing to Roma with the days at sea and ashore, and no march round the sea',
    );
    await page.keyboard.press('Escape');
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Orders for Roma' }).waitFor();
    await shot(
      'port-menu-roma-as-carthage',
      'As Carthage a right click on Roma, a port, offers only the crossing: the march of 287 days is gone',
    );

    await openGame(page, { power: 'rome' });
    await pause(page);
    const romeView = await selectArmy(page, cityPoint('roma'), 'Idle at Roma');
    const massalia = romeView.city('massalia');
    await page.mouse.click(massalia.x, massalia.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Orders for Massalia' }).waitFor();
    await shot(
      'port-menu-massalia-as-rome',
      'As Rome a right click on Massalia offers both ways, because neither takes more than half again the days of the other',
    );
  },
});
