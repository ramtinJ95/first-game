import { camera, cityPoint, crossingToCaralis, pause, resume } from '../../../e2e/support.ts';
import { loadSave, stillAfter, untilDay } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'crossing',
  title:
    "Rome's transports cross the sea to Caralis at speed 2 and land the army, then a column of refugees walks from Roma to Capua",
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    const state = crossingToCaralis(15);
    await loadSave(page, state);
    const caralis = cityPoint('caralis');
    const convoy = Object.values(state.convoys)[0];
    const view = camera(page);
    const centre = convoy
      ? { x: (convoy.position.x + caralis.x) / 2, y: (convoy.position.y + caralis.y) / 2 }
      : caralis;
    await view.jumpTo(centre, 2.4);
    await page.getByRole('button', { name: 'Speed 2', exact: true }).click();
    await resume(page);
    await untilDay(page, state.day + 7, 400, 20_000);
    await pause(page);
    await shot('landed', 'The army landed at Caralis and stands at the harbour');
    await stillAfter(page, crossingToCaralis(12), 400);
    await shot(
      'convoy',
      'The convoy at sea: transports under sail and oars along their course, each with its wake',
    );
  },
});
