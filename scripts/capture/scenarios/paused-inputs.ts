import {
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  playDays,
  resizeTo,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'paused-inputs',
  title:
    'A paused game after each kind of input: it draws only on a change, and shows each at once',
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    const ready = () => page.locator('canvas[data-terrain="ready"]').waitFor();
    await openGame(page);
    await page.mouse.move(0, 0);
    await pause(page);
    await untilDrawn(page);
    await ready();
    await shot('paused', 'Paused at the whole map: the top bar reads Paused');

    const view = camera(page);
    await view.jumpTo(cityPoint('roma'), 1);
    await ready();
    await shot('zoomed', 'Zoomed to the middle zoom over Roma while paused');

    await view.drag({ x: 640, y: 360 }, { x: 520, y: 300 });
    await ready();
    await shot(
      'panned',
      'Panned towards the south-east while paused: Roma stands up and to the left',
    );

    const roma = view.city('roma');
    await page.mouse.move(roma.x, roma.y, { steps: 4 });
    await shot('hovered', 'The pointer over Roma: the map is as it was, nothing to draw');

    await page.mouse.click(roma.x, roma.y);
    await page.getByTestId('city-name').filter({ hasText: 'Roma' }).waitFor();
    await untilDrawn(page);
    await shot('selected', 'Roma selected while paused: its outline and its panel');

    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByTestId('overview').waitFor();
    await shot('panel-open', 'The Overview opened over the paused map');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByTestId('overview').waitFor({ state: 'detached' });
    await shot('panel-closed', 'The Overview closed: the map under it as before');

    await resizeTo(page, { width: 1024, height: 640 });
    await resizeTo(page, { width: 1280, height: 720 });
    await ready();
    await shot('resized', 'The window made smaller and back to 1280 × 720 while paused');

    await page.keyboard.press('Escape');
    await view.jumpTo(cityPoint('roma'), 0.5);
    await ready();
    const army = view.banner(cityPoint('roma'));
    await page.mouse.click(army.x, army.y);
    await page.getByTestId('army-activity').waitFor();
    const capua = view.city('capua');
    await page.mouse.click(capua.x, capua.y, { button: 'right' });
    await page.getByTestId('orders-waiting').waitFor();
    await untilDrawn(page);
    await shot(
      'ordered',
      'An order to march to Capua given while paused: the faint dashed path of an order not yet applied',
    );

    const loaded = playDays(startGame(), 20);
    await dropSave(page, loaded);
    await page
      .getByTestId('time-controls-day')
      .and(page.locator(`[data-day="${loaded.day}"]`))
      .waitFor();
    await untilDrawn(page);
    await ready();
    await shot('loaded', `A save of day ${loaded.day} loaded while paused`);

    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Start screen' }).click();
    await page.getByRole('button', { name: 'Leave without saving' }).click();
    await page.getByTestId('power-carthage').click();
    await untilDrawn(page);
    await ready();
    await shot('new-game', 'A new game as Carthage: paused on its capital with the guide open');
  },
});
