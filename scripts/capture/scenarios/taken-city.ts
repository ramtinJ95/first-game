import {
  dropSave,
  mediolanumFallsTomorrow,
  openGame,
  pause,
  resume,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import { REFUSED_SAVE } from '../../../src/app/saves.ts';
import { saveGame } from '../../../src/sim/save.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'taken-city',
  title:
    'A city starved out falls with half its food, the fate prompt says what it holds and how to keep it, and an old save is refused in one sentence',
  viewport: { width: 1600, height: 900 },
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    await dropSave(page, mediolanumFallsTomorrow());
    await resume(page);
    await page.getByTestId('fate-prompt').waitFor();
    await page.getByTestId('fate-stores').waitFor();
    await untilDrawn(page);
    await shot(
      'fate-stores',
      'Mediolanum falls to Rome after its food ran out: the prompt says it holds half its food, its walls and garrison, and that an army of yours at it keeps it',
    );
    await page.getByTestId('fate-occupy').click();

    await pause(page);
    const state = JSON.parse(saveGame(startGame())).state as unknown;
    await page.getByTestId('import-file').setInputFiles({
      name: 'old.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 13, state })),
    });
    await page.getByTestId('notice').filter({ hasText: REFUSED_SAVE.older }).waitFor();
    await untilDrawn(page);
    await shot(
      'old-save',
      'A save from before the change sets is refused in one sentence that says what to do; the detail goes to the console',
    );
  },
});
