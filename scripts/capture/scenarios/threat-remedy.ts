import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  declareWar,
  dropSave,
  openGame,
  pause,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { FactionId, FormationId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

/**
 * Rome with 1,000 men in the field beside a Carthage of 2,000, so Carthage presses it by its
 * field armies. Macedon, at war with Egypt, may press no rival, so it weighs Capua.
 */
function carthagePresses(): GameState {
  const state = carthageNearsWar();
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  if (!punic || !roman) throw new Error('no armies');
  punic.men = 2000;
  roman.men = 1000;
  declareWar(state, macedon, egypt);
  return state;
}

const macedon = 'macedon' as FactionId;
const egypt = 'egypt' as FactionId;

async function showCity(page: Page, name: string) {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page
    .getByTestId('overview-cities')
    .getByRole('button', { name: new RegExp(name) })
    .click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('city-name')).toHaveText(name);
}

export default defineScenario({
  name: 'threat-remedy',
  title:
    'A field-army threat above a city threat in the Wars panel, each saying what lowers it, and the Guards section at the city naming the threat guards cannot answer',
  async run({ page, shot }) {
    await openGame(page);
    const state = carthagePresses();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await page.getByTestId('wars-button').click();
    const rows = page.getByTestId('wars-panel').getByTestId('threat-row');
    await expect(rows.first()).toContainText('against all your armies in the field');
    await expect(rows.filter({ hasText: /^Macedon has/ })).toContainText('near Capua');
    await shot(
      'threat-remedy-panel',
      'Carthage presses Rome by its field armies, so more men help and guards do not; Macedon weighs Capua, where its guards and armies count',
    );
    await page.getByTestId('wars-button').click();
    await showCity(page, 'Capua');
    const guards = page.getByTestId('city-guards');
    await guards.scrollIntoViewIfNeeded();
    await expect(
      guards.getByTestId('guards-threat').filter({ hasText: /^Carthage/ }),
    ).toContainText('guards do not hold that back');
    await shot(
      'threat-remedy-guards',
      "Capua's guards: Macedon's share with one more band, and Carthage's pressure, which guards do not hold back",
    );
  },
});
