import { openGame, pause, startGame } from '../../../e2e/support.ts';
import { SAVE_FORMAT, saveGame } from '../../../src/sim/save.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'save-format',
  title:
    'Saved games name the missing or unknown state change instead of comparing a shared version number',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    for (const [name, format, change] of [
      [
        'missing-change',
        SAVE_FORMAT.filter((id) => id !== 'baseline-format-12'),
        'baseline-format-12',
      ],
      ['unknown-change', [...SAVE_FORMAT, 'future-fleets'], 'future-fleets'],
    ] as const) {
      const state = JSON.parse(saveGame(startGame())).state as unknown;
      await page.getByTestId('import-file').setInputFiles({
        name: `${name}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ format, state })),
      });
      const notice = page.getByTestId('notice').filter({ hasText: change });
      await notice.waitFor();
      await shot(name, `The import refusal names ${change}; the running game is not replaced`);
    }
  },
});
