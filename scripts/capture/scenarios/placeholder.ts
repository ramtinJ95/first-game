import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'placeholder',
  title: 'Skeleton app: the placeholder map marker circling under the day panel',
  async run({ page, shot }) {
    await page.goto('/');
    await page.locator('canvas').waitFor({ state: 'visible' });
    await page.getByTestId('panel').waitFor({ state: 'visible' });
    await shot('start', 'Skeleton app on load: parchment map canvas with the "Day 1" panel');
    await page.waitForTimeout(3000);
    await shot(
      'later',
      'Skeleton app three seconds later: the map marker has moved along its circle',
    );
  },
});
