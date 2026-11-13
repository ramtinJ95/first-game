import {
  camera,
  cityPoint,
  pause,
  refugeesToCapua,
  resume,
  openGame,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'column',
  title: 'A column of refugees from Roma walks the road to Capua with its carts',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = refugeesToCapua();
    await loadSave(page, state);
    const column = Object.values(state.refugeeColumns)[0];
    const at = column?.position ?? cityPoint('roma');
    const view = camera(page);
    await view.jumpTo({ x: at.x + 60, y: at.y - 40 }, 0.6);
    await page.waitForTimeout(800);
    await shot(
      'refugees-wide',
      'At a zoom where an army is its flag, the column on the road to Capua is a small ox cart in its owner colour',
    );
    await view.jumpTo(at, 4);
    await resume(page);
    await page.waitForTimeout(1400);
    await pause(page);
    await shot(
      'refugees',
      'Refugees on the road: people on foot, in the owner colour, with ox carts loaded with their goods',
    );
  },
});
