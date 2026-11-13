import { camera, openGame, pause, startGame } from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

/** The middle of the Apennines, between Roma and the Adriatic. */
const APENNINES = { x: 2600, y: 2290 };
/** The hills of Tuscany between Arretium and the coast, in the Italian woods. */
const TUSCANY = { x: 2454, y: 2190 };

export default defineScenario({
  name: 'italy',
  title: "Italy's woods from the map data at the widest, the middle, and the closest zoom",
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    await loadSave(page, startGame());
    await page.waitForTimeout(800);
    await shot('italy-widest', 'The whole map: the woods of Italy among those of Europe');
    const view = camera(page);
    await view.jumpTo(APENNINES, 1.1);
    await page.waitForTimeout(1500);
    await shot(
      'italy-middle',
      "Italy at the middle zoom: the Apennine, Italian, and Tyrrhenian woods under Rome's wash",
    );
    await view.jumpTo(TUSCANY, 4);
    await page.waitForTimeout(2500);
    await shot('italy-closest', 'The hills of Tuscany at the closest zoom: trees in the woods');
  },
});
