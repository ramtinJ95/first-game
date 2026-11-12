import { armyAtRest, camera, cityPoint, pause } from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'zooms',
  title: "Rome's army of four formations at the widest, a middle, and the closest zoom",
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    await loadSave(page, armyAtRest());
    await page.waitForTimeout(500);
    await shot('army-widest', 'The widest zoom: the army is its flag, as before');
    const view = camera(page);
    await view.closeUp(cityPoint('roma'), 9);
    await page.waitForTimeout(1200);
    await shot(
      'army-middle',
      'A middle zoom: four blocks of figures behind the standard and the general, beside Roma',
    );
    await view.zoom({ x: 640, y: 360 }, 9);
    await page.waitForTimeout(1200);
    await shot(
      'army-closest',
      'The closest zoom: spearmen, swordsmen, archers, and heavy horse at ease, with their camp behind them',
    );
  },
});
