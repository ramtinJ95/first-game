import { camera, cityPoint, pause, refugeesToCapua, resume } from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'column',
  title: 'A column of refugees from Roma walks the road to Capua with its carts',
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    const state = refugeesToCapua();
    await loadSave(page, state);
    const column = Object.values(state.refugeeColumns)[0];
    await camera(page).jumpTo(column?.position ?? cityPoint('roma'), 4);
    await resume(page);
    await page.waitForTimeout(1400);
    await pause(page);
    await shot(
      'refugees',
      'Refugees on the road: people on foot, in the owner colour, with ox carts loaded with their goods',
    );
  },
});
