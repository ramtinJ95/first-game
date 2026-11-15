import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  openGame,
  pause,
  resume,
  rome,
  startGame,
} from '../../../e2e/support.ts';
import { loadSave, untilDay } from '../../../e2e/watch.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import { defineScenario } from '../scenario.ts';

/** Where the sixth play-through's First Legion stood, a day inland of Hippo Regius. */
const BY_HIPPO_REGIUS = { x: 2004.2, y: 2831.5 };

export default defineScenario({
  name: 'march-then-sail',
  title:
    'At peace with Carthage and at war with Syracusae, a legion a day inland of Hippo Regius takes the menu line to sail for Syracusae, gathers ships at the shore, and sails',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = startGame();
    declareWar(state, rome, 'syracusae' as FactionId);
    const army = armyOf(state, rome);
    army.activity = { kind: 'idle', position: { ...BY_HIPPO_REGIUS } };
    await loadSave(page, state);

    const view = camera(page);
    await view.jumpTo(BY_HIPPO_REGIUS, 0.5);
    const flag = view.banner(BY_HIPPO_REGIUS);
    await page.mouse.click(flag.x, flag.y);
    await page.getByTestId('army-activity').filter({ hasText: 'Idle' }).waitFor();
    const target = cityPoint('syracusae');
    await view.jumpTo(
      { x: (BY_HIPPO_REGIUS.x + target.x) / 2, y: (BY_HIPPO_REGIUS.y + target.y) / 2 },
      0.25,
    );
    const syracusae = view.city('syracusae');
    await page.mouse.click(syracusae.x, syracusae.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Orders for Syracusae' });
    await menu.waitFor();
    await shot(
      'menu',
      'The only line: march to the shore at Hippo Regius to sail for Syracusae, with the days of each leg',
    );

    await menu.getByRole('menuitem', { name: /^March to the shore at Hippo Regius/ }).click();
    await resume(page);
    await untilDay(page, state.day + 1);
    await pause(page);
    await page
      .getByTestId('army-activity')
      .filter({ hasText: /^Gathering ships/ })
      .waitFor();
    await shot(
      'gathering',
      'A day on, the legion is at the shore and gathering its ships, then sails for Syracusae',
    );

    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await untilDay(page, state.day + 13, 0, 60_000);
    await pause(page);
    await view.jumpTo(cityPoint('hippo-regius'), 0.5);
    await page
      .getByTestId('army-activity')
      .filter({ hasText: /^At sea to Syracusae/ })
      .waitFor();
    await shot('at-sea', 'Its ships gathered, the legion is at sea to Syracusae');
  },
});
