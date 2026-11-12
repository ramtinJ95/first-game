import {
  camera,
  cityPoint,
  fieldBattle,
  pause,
  playAi,
  playDays,
  resume,
} from '../../../e2e/support.ts';
import { loadSave, stillAfter } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'battle',
  title:
    'A battle at the closest zoom outside Roma, from the first contact to the rout of Carthage, at speed 2',
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    // The battle is joined before the save is dropped: left to itself, the AI would march away.
    const start = playDays(fieldBattle(), 1);
    await loadSave(page, start);
    const roma = cityPoint('roma');
    await camera(page).jumpTo({ x: roma.x + 100, y: roma.y - 8 }, 4);
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByRole('button', { name: /held the field/ })
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await pause(page);
    await page.getByRole('button', { name: 'Speed 1', exact: true }).click();

    await stillAfter(page, start, 1500);
    await shot(
      'battle-first-day',
      'The first full day of fighting: the lines meet, the front ranks fight, arrows and javelins fly, and the horse works the wings',
    );
    await stillAfter(page, playAi(start, 3), 1600);
    await shot(
      'battle-rout',
      "Day 6: Carthage's skirmishers and light horse break and run while its foot still holds",
    );
    await stillAfter(page, playAi(start, 5), 1400);
    await shot(
      'battle-last-day',
      'Day 8, the last: Carthage leaves the field and Rome raises its standard',
    );
  },
});
