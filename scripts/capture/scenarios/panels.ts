import type { Page } from '@playwright/test';
import {
  armyOf,
  battleAt,
  camera,
  cityPoint,
  declareWar,
  dropSave,
  fallenTo,
  pause,
  playDays,
  resume,
  rome,
  setRich,
  startGame,
} from '../../../e2e/support.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await page
    .getByTestId('time-controls-day')
    .and(page.locator(`[data-day="${state.day}"]`))
    .waitFor();
  await page.waitForTimeout(250);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
}

export default defineScenario({
  name: 'panels',
  title:
    'Each panel in use: the top bar, your army and a foreign one, a city raising troops, the sea crossing, a battle, a siege, a fallen city, a refused order, and the alerts',
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
    await pause(page);
    const view = camera(page);
    await view.closeUp(cityPoint('roma'), 6);

    const poor = startGame();
    const spearmen = poor.formations[armyOf(poor, rome).formations[0] ?? ('' as never)];
    if (spearmen) spearmen.men = 4000;
    const poorStores = poor.factions[rome]?.stores;
    if (poorStores) poorStores.gold = 400;
    await load(page, poor);
    await shot(
      'top-bar',
      "The top bar: Rome's gold marked red because a large army's upkeep empties it within days",
    );

    const rich = startGame();
    setRich(rich);
    await load(page, rich);
    const banner = view.banner(cityPoint('roma'));
    await page.mouse.click(banner.x, banner.y);
    const target = view.city('arretium');
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await resume(page);
    await page.waitForTimeout(1600);
    await pause(page);
    await shot(
      'army-own',
      'Your army selected: formations, general, activity with days left, stance, halt, and its path on the map',
    );

    await page.mouse.click(
      view.banner(cityPoint('carthago')).x,
      view.banner(cityPoint('carthago')).y,
    );
    await page
      .getByTestId('army-panel')
      .getByRole('button', { name: 'Declare war on Carthage' })
      .click();
    await shot(
      'army-foreign',
      'A foreign army: the same facts, no orders, and the declaration of war waiting for its confirmation',
    );

    await load(page, rich);
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y);
    const city = page.getByTestId('city-panel');
    await city.getByRole('button', { name: /^Skirmishers/ }).click();
    await city.getByRole('button', { name: /^Heavy cavalry/ }).click();
    await resume(page);
    await page.waitForTimeout(1200);
    await pause(page);
    await shot(
      'city-recruiting',
      'Roma raising skirmishers and heavy cavalry with days left, the troop buttons with their costs, and the evacuation',
    );

    await page.mouse.click(banner.x, banner.y);
    const salona = view.city('salona');
    await page.mouse.click(salona.x, salona.y, { button: 'right' });
    await page.getByTestId('command-menu').waitFor();
    await shot(
      'sea-crossing',
      'A right click on the port of Salona, with the army at Roma, offers the crossing by sea',
    );
    await page.keyboard.press('Escape');

    const sea = view.screen({ x: 2300, y: 2500 });
    await page.mouse.click(sea.x, sea.y, { button: 'right' });
    await resume(page);
    await page.getByTestId('notice').waitFor();
    await pause(page);
    await shot(
      'refused-order',
      'A march into the sea is refused, and the reason shows for a few seconds',
    );

    const fallen = startGame();
    fallenTo(fallen, 'mediolanum');
    await load(page, fallen);
    await view.drag(view.city('mediolanum'), { x: 640, y: 360 });
    const milan = view.city('mediolanum');
    await page.mouse.click(milan.x, milan.y);
    await shot(
      'city-fallen',
      'Mediolanum fell to Rome today: unrest, and the choice to sack or enslave while the army stands there',
    );

    const siege = startGame();
    setRich(siege);
    declareWar(siege, rome, 'mediolanum' as FactionId);
    armyOf(siege, rome).activity = { kind: 'idle', position: cityPoint('mediolanum') };
    await load(page, playDays(siege, 6));
    await page.mouse.click(milan.x, milan.y);
    await page.getByTestId('city-panel').getByRole('button', { name: 'Storm the walls' }).waitFor();
    await shot(
      'city-siege',
      'Mediolanum besieged by Rome: walls, garrison, and food worn down, and the walls can be stormed',
    );

    const battle = startGame();
    battleAt(battle, 'mediolanum');
    await load(page, battle);
    await resume(page);
    await page.getByTestId('battle-panel').waitFor();
    await page.waitForTimeout(1500);
    await pause(page);
    const marker = view.screen(cityPoint('mediolanum'));
    await page.mouse.click(marker.x + 2, marker.y + 6);
    await shot(
      'battle',
      'The battle marker selected: both sides with their formations, men, morale, and the day count',
    );

    await page
      .getByTestId('battle-panel')
      .getByRole('button', { name: /^Rome ·/ })
      .click();

    await page.getByTestId('army-panel').waitFor();
    await resume(page);
    await page.waitForTimeout(400);
    await page.evaluate(() => performance.clearMeasures('panels'));
    await page.waitForTimeout(4000);
    const durations = await page.evaluate(() =>
      performance.getEntriesByName('panels').map((entry) => entry.duration),
    );
    const sorted = durations.sort((a, b) => a - b);
    const summary =
      `Panel refresh with the top bar, the army panel, the battle panel, and the alerts open: ` +
      `${sorted.length} refreshes, median ${percentile(sorted, 0.5).toFixed(2)} ms, ` +
      `p95 ${percentile(sorted, 0.95).toFixed(2)} ms, max ${(sorted.at(-1) ?? NaN).toFixed(2)} ms`;
    console.log(summary);
    await pause(page);
    await shot('battle-and-army', summary);

    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByRole('button', { name: /held the field/ })
      .waitFor({ timeout: 30_000 });
    await pause(page);
    await shot(
      'alerts',
      'The alerts at the left edge: the battle began, and who held the field when it ended',
    );
  },
});
