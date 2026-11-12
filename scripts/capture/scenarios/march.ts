import {
  armyOf,
  camera,
  cityPoint,
  marchToCamp,
  pause,
  resume,
  rome,
} from '../../../e2e/support.ts';
import { loadSave, untilDay } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'march',
  title:
    "Rome's army marches in column along its road at speed 1, arrives, and makes camp the next day",
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    const state = marchToCamp();
    await loadSave(page, state);
    const roma = cityPoint('roma');
    const view = camera(page);
    await view.jumpTo({ x: roma.x - 30, y: roma.y - 72 }, 4);
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await resume(page);
    await untilDay(page, state.day + 1, 250);
    await shot(
      'march',
      'The column on the road: the standard and the general lead, each formation marches in ranks behind',
    );
    const army = armyOf(state, rome);
    const last = army.activity.kind === 'marching' ? state.day + 5 : state.day + 1;
    await untilDay(page, last + 1, 300, 20_000);
    await pause(page);
    await shot(
      'camp',
      'A day after it arrived the army stands at ease in its lanes, with its tents and fires pitched behind it',
    );
  },
});
