import { camera, openGame, pause, startGame } from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

/** Places the first play-through found empty at the closest zoom, away from mountains and woods. */
const VIEWS = [
  { name: 'roma', title: 'The farmland east of Roma', at: { x: 2545, y: 2360 } },
  { name: 'gaul', title: 'Open Gaul south of Lutetia', at: { x: 1960, y: 1500 } },
  {
    name: 'delta',
    title: 'The Nile delta between Alexandria and Pelusium',
    at: { x: 4070, y: 3620 },
  },
  { name: 'plateau', title: 'The Persian plateau north of Persepolis', at: { x: 6080, y: 3330 } },
] as const;

export default defineScenario({
  name: 'closest',
  title:
    'Four views at the closest zoom: near Roma, in Gaul, in the Nile delta, and on the Persian plateau',
  async run({ page, shot }) {
    for (const { name, title, at } of VIEWS) {
      // Each view starts from a fresh page at the widest zoom, so the camera the helper
      // follows is the page's own.
      await openGame(page);
      await pause(page);
      await loadSave(page, startGame());
      await camera(page).jumpTo(at, 4);
      await page.waitForTimeout(500);
      await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await shot(`closest-${name}`, `${title} at the closest zoom`);
    }
  },
});
