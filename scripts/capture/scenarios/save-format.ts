import { openGame, pause, startGame } from '../../../e2e/support.ts';
import { REFUSED_SAVE } from '../../../src/app/saves.ts';
import { SAVE_FORMAT, saveGame } from '../../../src/sim/save.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'save-format',
  title:
    'A save the game cannot open is refused in one sentence that says what to do, and the missing or unknown change goes to the console',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    for (const [name, format, change] of [
      [
        'missing-change',
        SAVE_FORMAT.filter((id) => id !== 'baseline-format-12'),
        REFUSED_SAVE.older,
      ],
      ['unknown-change', [...SAVE_FORMAT, 'future-fleets'], REFUSED_SAVE.newer],
    ] as const) {
      const state = JSON.parse(saveGame(startGame())).state as unknown;
      await page.getByTestId('import-file').setInputFiles({
        name: `${name}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ format, state })),
      });
      const notice = page.getByTestId('notice').filter({ hasText: change });
      await notice.waitFor();
      await shot(name, `The import is refused: "${change}" The running game is not replaced`);
    }
  },
});
