import { expect, type Page } from '@playwright/test';
import { armyOf, openGame, resizeTo, rome } from '../../../e2e/support.ts';
import { foodShortUnlessWaiting, loadWarnings, showOwnCity } from '../../../e2e/warnings-game.ts';
import type { FormationId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

/**
 * Rome as in `foodShortUnlessWaiting` with 500 more men under arms and 600 to call up: Spearmen
 * want 400 more men, which Barracks at Roma bring in 46 days, and Skirmishers are fed only with Canals.
 */
function menAndFoodShort(): GameState {
  const state = foodShortUnlessWaiting();
  const stores = state.factions[rome]?.stores;
  const formation = state.formations[armyOf(state, rome).formations[0] as FormationId];
  if (!stores || !formation) throw new Error('no Roman stores or army');
  stores.manpower = 600;
  formation.men += 500;
  return state;
}

async function both(page: Page) {
  await expect(page.getByTestId('recruit-canal')).toContainText(
    'Or build Canals at Roma for 4,000 gold',
  );
  const barracks = page.getByTestId('recruit-barracks').first();
  await expect(barracks).toContainText(
    'Or build Barracks at Roma for 7,000 gold, which give 1,000 more men to call up',
  );
  await barracks.scrollIntoViewIfNeeded();
}

export default defineScenario({
  name: 'recruit-barracks',
  title:
    'The Spearmen card wants 400 more men and names Barracks at Roma and the day they let the raise, beside the Skirmishers warning that names Canals',
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await loadWarnings(page, menAndFoodShort());
    await showOwnCity(page, 'Roma');
    await page
      .getByTestId('recruit-cards')
      .getByRole('button', { name: /^Skirmishers/ })
      .click();
    await both(page);
    await shot(
      'recruit-barracks-1280',
      'The Skirmishers warning names Canals, and the Spearmen card, 400 men short, names Barracks at Roma and its day, at 1280 by 720',
    );
    await resizeTo(page, PHONE);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    await both(page);
    await shot(
      'recruit-barracks-390',
      'The same lines at 390 px wide, where the side column is a sheet',
    );
  },
});
