import type { Page } from '@playwright/test';
import {
  camera,
  cityPoint,
  dropSave,
  pause,
  playDays,
  resume,
  startGame,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

async function settle(page: Page, ms = 350) {
  await page.waitForTimeout(ms);
}

export default defineScenario({
  name: 'campaign',
  title:
    "A short campaign through the page: select Rome's army, march it to Mediolanum, declare war on Mediolanum, raise skirmishers in Roma, run the days until the army arrives and besieges the city, and open the alert",
  async run({ page, shot }) {
    // Day 36 of a game played without orders, so Rome has saved enough to raise a troop.
    const save = playDays(startGame(), 35);
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    await dropSave(page, save);
    await page.getByTestId('time-controls-day').filter({ hasText: 'day 36' }).waitFor();

    const view = camera(page);
    const roma = cityPoint('roma');
    const mediolanum = cityPoint('mediolanum');
    await view.closeUp({ x: (roma.x + mediolanum.x) / 2, y: (roma.y + mediolanum.y) / 2 }, 6);

    const banner = view.banner(roma);
    await page.mouse.click(banner.x, banner.y);
    await page.getByTestId('army-panel').waitFor();
    await settle(page);

    const target = view.screen(mediolanum);
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await settle(page);
    await shot(
      'campaign-march-ordered',
      "Rome's army selected and sent to Mediolanum by a right click while paused: its path shows faintly until the next day",
    );

    await page.mouse.click(target.x, target.y);
    const city = page.getByTestId('city-panel');
    await city.getByRole('button', { name: 'Declare war on Mediolanum' }).click();
    await settle(page, 250);
    await shot(
      'campaign-declare-war',
      'The city panel of Mediolanum asks to confirm the declaration of war',
    );
    await city.getByRole('button', { name: 'Confirm war' }).click();
    await settle(page, 250);

    const capital = view.screen(roma);
    await page.mouse.click(capital.x, capital.y);
    await city.getByRole('button', { name: /^Skirmishers/ }).click();
    await settle(page);

    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await page.waitForTimeout(800);
    await shot(
      'campaign-marching',
      'The days run at speed 3: the army marches along its inked path and the skirmishers train in Roma',
    );

    const arrived = page.getByTestId('alerts').getByRole('button', { name: /Your army arrived/ });
    await arrived.waitFor({ timeout: 20_000 });
    await pause(page);
    await settle(page, 300);
    await shot(
      'campaign-alerts',
      'The alerts tell that the army arrived at Mediolanum and besieges it, and that the skirmishers mustered in Roma',
    );

    await page.keyboard.press('Escape');
    await arrived.click();
    await page.getByTestId('army-panel').waitFor();
    await settle(page, 500);
    await shot(
      'campaign-alert-opened',
      'A click on the alert centres the map on Mediolanum and selects the besieging army',
    );
  },
});
