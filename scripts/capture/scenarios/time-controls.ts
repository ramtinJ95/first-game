import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'time-controls',
  title: 'Time controls: the day counter runs, pauses on Space, and runs faster at speed 3',
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('time-controls').waitFor({ state: 'visible' });
    await shot(
      'start',
      'On load: the top bar reads Rome, its gold, food, and manpower with their daily change, Year 1, day 1, and speed 1',
    );

    await page.waitForTimeout(2500);
    await shot('running', 'After 2.5 seconds at speed 1: the day counter has advanced');

    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Resume' }).waitFor({ state: 'visible' });
    await shot('paused', 'Space pressed: the top bar reads Paused and the button offers Resume');

    await page.waitForTimeout(2000);
    await shot('still-paused', 'Two seconds later: the day has not moved while paused');

    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await shot('speed-3', 'Resumed and switched to speed 3: the speed 3 button is pressed');

    await page.waitForTimeout(2500);
    await shot('fast', 'After 2.5 seconds at speed 3: the day has jumped about twelve days');
  },
});
