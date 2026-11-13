import { expect, type Page } from '@playwright/test';
import {
  camera,
  carthageSailsOnRoma,
  cityPoint,
  dropSave,
  mediolanumFallsTomorrow,
  openGame,
  pause,
  resume,
  siegeOfCarthago,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** Clicks the province 40 km south of the city, clear of the armies on its symbol. */
async function openCity(page: Page, id: string, name: string) {
  const at = cityPoint(id);
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText(name);
}

export default defineScenario({
  name: 'prompts',
  title:
    'The prompts say what they do: the fate of a city with what occupying yields, a storm with its odds, a fleet sighted, and an evacuation told',
  async run({ page, shot }) {
    await openGame(page);
    const alerts = page.getByTestId('alerts');

    await load(page, mediolanumFallsTomorrow());
    await resume(page);
    const prompt = page.getByTestId('fate-prompt');
    await prompt.waitFor();
    await shot(
      'fate-prompt',
      'Mediolanum falls to Rome: each fate says what the city then yields a day, and what a sack or an enslavement takes from occupying it',
    );
    await prompt.getByTestId('fate-occupy').click();

    await load(page, siegeOfCarthago());
    await openCity(page, 'carthago', 'Carthago');
    await page.getByRole('button', { name: 'Storm the walls' }).click();
    await page.getByTestId('storm-odds').waitFor();
    await shot(
      'storm-confirmation',
      "The storm of Carthago asks to be confirmed with the rules' odds: how often it takes the city, and the men it is expected to cost",
    );
    await page.getByRole('button', { name: 'Cancel' }).click();

    await load(page, carthageSailsOnRoma());
    await resume(page);
    await alerts.getByText(/A fleet of Carthage with [\d,]+ men is sailing for/).waitFor();
    await pause(page);
    await shot(
      'fleet-sighted',
      "Carthage's fleet comes into Rome's sight on its way to Roma: one alert with its men and where it sails",
    );

    await load(page, startGame());
    await openCity(page, 'roma', 'Roma');
    await page.getByRole('button', { name: /^Evacuate [\d,]+ people$/ }).click();
    await resume(page);
    await alerts.getByText(/people left Roma for/).waitFor();
    await pause(page);
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('overview-columns').waitFor();
    await shot(
      'evacuation-left',
      'The people of Roma leave for Capua: an alert tells of it, and the overview lists them on the road',
    );
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await alerts.getByText(/people from Roma settled in/).waitFor();
    await pause(page);
    await shot('evacuation-arrived', 'They settle in Capua, and an alert tells of that too');
  },
});
