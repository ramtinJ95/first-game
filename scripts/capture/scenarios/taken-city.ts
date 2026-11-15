import {
  dropSave,
  mediolanumFallsTomorrow,
  openGame,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'taken-city',
  title:
    'A city starved out falls with half its food, and the fate prompt says what food, walls, and garrison it holds and how to keep it',
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
      'Mediolanum falls to Rome after its food ran out: the prompt says it holds half its food, with its walls and garrison against their full values, and that an army of yours at it keeps it',
    );
  },
});
