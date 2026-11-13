import type { Page } from '@playwright/test';
import {
  armyOf,
  beatenNearHadrumetum,
  camera,
  cityPoint,
  idleBesideEnemyCity,
  openGame,
  pause,
  resume,
  rome,
} from '../../../e2e/support.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

/** Waits for the army panel to say what the army is doing, for as long as a voyage takes. */
async function untilActivity(page: Page, activity: RegExp) {
  await page
    .getByTestId('army-activity')
    .filter({ hasText: activity })
    .waitFor({ timeout: 60_000 });
}

/** Selects the army on its flag at the point, at the widest view or zoomed to `scale`, and waits for its panel. */
async function selectArmy(page: Page, point: MapPoint, scale?: number) {
  const view = camera(page);
  if (scale) await view.jumpTo(point, scale);
  const flag = view.banner(point);
  await page.mouse.click(flag.x, flag.y);
  await page.getByTestId('army-panel').waitFor();
  return view;
}

function standing(state: GameState): MapPoint {
  const { activity } = armyOf(state, rome);
  if (activity.kind !== 'idle') throw new Error(`the Roman army is ${activity.kind}`);
  return activity.position;
}

export default defineScenario({
  name: 'order-paths',
  title:
    'A Roman army beaten overseas sails home from the shore, a crossing for Capua lands at Roma and marches on, and an army beside an enemy city offers Besiege',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const beaten = beatenNearHadrumetum();
    await loadSave(page, beaten);
    const view = await selectArmy(page, standing(beaten));
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Orders for Roma' }).waitFor();
    await shot(
      'stranded-menu',
      'Beaten at Carthago and in the field near Hadrumetum, the army is offered the crossing home from the shore, with the days it waits for ships',
    );

    await openGame(page, { power: 'carthage' });
    await pause(page);
    const carthage = await selectArmy(page, cityPoint('carthago'));
    const capua = carthage.city('capua');
    await page.mouse.click(capua.x, capua.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Orders for Capua' }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Speed 3' }).click();
    await resume(page);
    await untilActivity(page, /^At sea .*, then marching to Capua/);
    await pause(page);
    await shot('sea-leg', 'At sea for Roma, the panel names the march on to Capua that follows');
    await resume(page);
    await untilActivity(page, /^Marching to Capua/);
    await pause(page);
    await shot('land-leg', 'Landed at Roma, the army marches on to Capua');

    await openGame(page);
    await pause(page);
    const beside = idleBesideEnemyCity('mediolanum');
    await loadSave(page, beside);
    await selectArmy(page, standing(beside), 2);
    await page.getByTestId('army-besiege').waitFor();
    await shot(
      'beside-enemy-city',
      'Idle 15 km from Mediolanum at war, the panel says why it does not besiege and offers Besiege',
    );
  },
});
