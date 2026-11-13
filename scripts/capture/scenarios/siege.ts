import {
  camera,
  cityPoint,
  pause,
  playDays,
  resume,
  stormedCarthago,
  siegeOfCarthago,
  openGame,
} from '../../../e2e/support.ts';
import { intoNextDay, loadSave, stillAfter } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'siege',
  title:
    'The siege of Carthago: the camp round the city, a storm with ladders at the walls, the fall, and the sack',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = siegeOfCarthago();
    await loadSave(page, state);
    const carthago = cityPoint('carthago');
    const view = camera(page);
    await view.jumpTo({ x: carthago.x + 14, y: carthago.y }, 4);
    await resume(page);
    await page.waitForTimeout(1500);
    const city = view.city('carthago');
    // A point of Carthago's province clear of the army that stands beside the city.
    const province = view.screen({ x: carthago.x + 8, y: carthago.y + 40 });
    await page.mouse.click(city.x, city.y);
    const panel = page.getByTestId('city-panel');
    await panel.getByRole('button', { name: 'Storm the walls' }).click();
    await panel.getByRole('button', { name: 'Confirm storm' }).click();
    await page
      .getByTestId('alerts')
      .getByRole('button', { name: /fell to Rome/ })
      .waitFor({ timeout: 15_000 });
    // The fall opens the fate prompt over the city. This scenario turns the prompt off,
    // so the later stills show the city, and leaves the fate to the city panel.
    const prompt = page.getByTestId('fate-prompt');
    await prompt.getByRole('checkbox').uncheck();
    await prompt.getByTestId('fate-occupy').click();
    await page.waitForTimeout(1200);
    await pause(page);
    await page.keyboard.press('Escape');

    await stillAfter(page, playDays(state, 1), 800);
    await shot(
      'siege-camp',
      'The Roman camp in a ring round Carthago on its landward side: tents, fires, the stakes and ditch facing the walls, and the worn walls',
    );
    await loadSave(page, playDays(state, 1));
    await page.mouse.click(city.x, city.y);
    await panel.getByRole('button', { name: 'Storm the walls' }).click();
    await panel.getByRole('button', { name: 'Confirm storm' }).click();
    // A frame this close takes long enough in software that the day would be over by the
    // time the clock pauses, so the day is entered at the widest zoom and shown close.
    const here = { x: carthago.x + 14, y: carthago.y };
    await view.jumpTo(here, 0.1);
    await intoNextDay(page, 0);
    await view.jumpTo(here, 4);
    await page.waitForTimeout(1500);
    await shot(
      'siege-storm',
      'The storm on the day it was ordered: ladders against the walls and men climbing them, as Carthago falls',
    );
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Pause' }).click();
    await shot(
      'siege-fallen',
      "Carthago fell to the storm: Rome's flag goes up over the city and the army stands beside it",
    );
    await loadSave(page, stormedCarthago());
    await page.mouse.click(province.x, province.y);
    await panel.getByRole('button', { name: /^Sack for/ }).click();
    await intoNextDay(page, 0);
    await page.keyboard.press('Escape');
    await shot(
      'siege-sacked',
      'The day after the sack was ordered, when the rules apply it: Carthago burns and smokes',
    );
  },
});
