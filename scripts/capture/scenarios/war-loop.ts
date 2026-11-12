import { camera, dropSave, outnumberedAt, pause, resume, startGame } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'war-loop',
  title:
    "One battle beside Capua at speed 1, from its first day to its last: Rome's army is outnumbered two to one, the alerts tell of the battle, its end with the losses, and the retreat to Roma, and the army falls back alive",
  async run({ page, shot }) {
    const state = startGame();
    outnumberedAt(state, 'capua', 3000);
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    await dropSave(page, state);
    await page.getByTestId('time-controls-day').filter({ hasText: 'day 1' }).waitFor();
    const view = camera(page);
    await view.zoom(view.city('capua'), 3, 0);
    await page.getByRole('button', { name: 'Speed 1', exact: true }).click();
    await resume(page);

    const alerts = page.getByTestId('alerts');
    await alerts.getByRole('button', { name: /Battle (at|near) Capua/ }).waitFor();
    await shot(
      'war-loop-battle-began',
      'Day 2: the armies lock together beside Capua and the alert tells of the battle',
    );
    const ended = alerts.getByRole('button', { name: /held the field (at|near) Capua/ });
    await ended.waitFor({ timeout: 20_000 });
    await pause(page);
    await shot(
      'war-loop-battle-ended',
      'The last day: the alerts tell who held the field, after how many days, the losses of both sides, and where the beaten army falls back',
    );
    await page
      .getByTestId('alerts')
      .getByRole('button', { name: /Your army broke/ })
      .click();
    await page.getByTestId('army-panel').waitFor();
    await page.waitForTimeout(400);
    await shot(
      'war-loop-retreating',
      "A click on the retreat alert selects Rome's army, which is retreating to Roma, the nearest city of Rome that no enemy threatens",
    );
  },
});
