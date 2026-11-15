import { expect } from '@playwright/test';
import { openGame } from '../../../e2e/support.ts';
import { foodShortUnlessWaiting, loadWarnings, showOwnCity } from '../../../e2e/warnings-game.ts';
import { fixtureWorld } from '../../../src/sim/fixture.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { tick } from '../../../src/sim/tick.ts';
import { recruitForecast } from '../../../src/ui/recruit-forecast.ts';
import { defineScenario } from '../scenario.ts';

/** The state on the day the card named, with no order given by anyone in between. */
function onTheNamedDay(state: GameState): GameState {
  const world = fixtureWorld();
  const wait = recruitForecast(state, [], world, 'spearmen').holdsAfter;
  if (wait === undefined) throw new Error('the card names no wait');
  let next = state;
  for (let day = 0; day < wait; day++) next = tick(next, [], world).state;
  return next;
}

export default defineScenario({
  name: 'recruit-wait',
  title:
    'A Spearmen raise at Roma warns and names its day and what the wait counts on, and on that day, with nothing done between, it raises at once',
  async run({ page, shot }) {
    await openGame(page);
    const state = foodShortUnlessWaiting();
    await loadWarnings(page, state);
    await showOwnCity(page, 'Roma');
    const cards = page.getByTestId('recruit-cards');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    const warning = page.getByTestId('recruit-warning');
    await expect(warning).toContainText('if you raise no other troops and lose no city');
    await warning.scrollIntoViewIfNeeded();
    await shot(
      'recruit-wait-first-day',
      'The card names the wait, its day, and that it counts on no other troops raised and no city lost',
    );

    await loadWarnings(page, onTheNamedDay(state));
    await showOwnCity(page, 'Roma');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    const raising = page.getByTestId('city-raising');
    await expect(raising).toContainText('Spearmen · ordered for the next day');
    await expect(warning).toHaveCount(0);
    await raising.scrollIntoViewIfNeeded();
    await shot(
      'recruit-wait-named-day',
      'On the day the card named, with no order given between, a click on the same card raises the Spearmen at once, with no warning',
    );
  },
});
