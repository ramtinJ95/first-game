import { openGame, pause, resizeTo, untilDrawn } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'resize',
  title: 'The map after the window is resized from 1280 px to 1600 px and to 1024 px',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    await untilDrawn(page);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    for (const size of [
      { width: 1600, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      await resizeTo(page, size);
      await page.locator('canvas[data-terrain="ready"]').waitFor();
      await page.waitForTimeout(1500);
      await shot(
        `resize-${size.width}`,
        `Resized to ${size.width} px: the sea, the land, the deserts, the woods, and the washes lie under their coasts and names`,
      );
    }
  },
});
