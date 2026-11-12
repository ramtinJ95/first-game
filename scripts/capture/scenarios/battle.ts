import {
  camera,
  cityPoint,
  fieldBattle,
  pause,
  playAi,
  playDays,
  resume,
  winnerMarchesOn,
  openGame,
} from '../../../e2e/support.ts';
import { intoNextDay, loadSave, stillAfter } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'battle',
  title:
    'A battle at the closest zoom outside Roma, from the first contact to the rout of Carthage, at speed 2',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    // The battle is joined before the save is dropped: left to itself, the AI would march away.
    const start = playDays(fieldBattle(), 1);
    await loadSave(page, start);
    const roma = cityPoint('roma');
    const view = camera(page);
    const field = { x: roma.x + 100, y: roma.y - 8 };
    await view.jumpTo(field, 4);
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
    // A frame at the closest zoom takes over a second in software, long enough for the
    // clock to play two days in one frame. The day is entered at the widest zoom, where
    // frames are quick, and shown close once the game is paused, when no day can pass.
    await openGame(page);
    await pause(page);
    await loadSave(page, winnerMarchesOn());
    await intoNextDay(page, 200);
    await camera(page).jumpTo(field, 4);
    await page.waitForTimeout(1500);
    await shot(
      'battle-winner-marches',
      'Day 8: Rome won the battle it met on its march and forms its column under its standard to march on east, while beaten Carthage runs west across the field',
    );
  },
});
