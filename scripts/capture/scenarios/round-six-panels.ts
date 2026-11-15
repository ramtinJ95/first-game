import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  camera,
  cityPoint,
  dropSave,
  map,
  openGame,
  pause,
  playAi,
  resume,
  rome,
  setRich,
  siegeToEndInPeace,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import { untilDay } from '../../../e2e/watch.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import { newGame } from '../../../src/sim/new-game.ts';
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

/** Seed 5 under the AI, a few days before Persia takes the lead it then holds through four ties. */
const BEFORE_PERSIA_LEADS = 2735;
const AFTER_THE_TIES = 2885;

export default defineScenario({
  name: 'round-six-panels',
  title:
    'Declare war from the army panel at peace, the truce a written peace buys at two payments, and the leading-power news of a ten-year game told once for each change of lead',
  async run({ page, shot }) {
    await openGame(page);

    const atMassalia = startGame();
    armyOf(atMassalia, rome).activity = { kind: 'idle', position: cityPoint('massalia') };
    await load(page, atMassalia);
    const banner = camera(page).banner(cityPoint('massalia'));
    await page.mouse.click(banner.x, banner.y);
    const army = page.getByTestId('army-panel');
    await army.getByRole('button', { name: 'Declare war on Massalia' }).waitFor();
    await shot(
      'army-declare-war',
      'A legion idle at Massalia at peace: the army panel says why it does not besiege, with the Declare war button the city panel has',
    );
    await army.getByRole('button', { name: 'Declare war on Massalia' }).click();
    await army.getByTestId('war-consequences').waitFor();
    await shot(
      'army-declare-war-confirm',
      'The button opens the same confirmation as the city panel, with what the war costs, Confirm war and Cancel',
    );

    const atWar = siegeToEndInPeace();
    setRich(atWar);
    await load(page, atWar);
    await page.getByTestId('wars-button').click();
    const wars = page.getByTestId('wars-panel');
    await wars.getByLabel('You pay Carthage').check();
    await wars.getByTestId('peace-gold').fill('1000');
    await wars.getByTestId('peace-draft-truce').filter({ hasText: '665 days' }).waitFor();
    await wars.getByTestId('peace-draft-truce').scrollIntoViewIfNeeded();
    await shot(
      'truce-1000-gold',
      'You pay Carthage 1,000 gold: the form says the truce these terms buy, 665 days, and its last day',
    );
    await wars.getByTestId('peace-gold').fill('2500');
    await wars.getByTestId('peace-draft-truce').filter({ hasText: '1,095 days' }).waitFor();
    await wars.getByTestId('peace-draft-truce').scrollIntoViewIfNeeded();
    await shot(
      'truce-2500-gold',
      'You pay 2,500 gold: the truce grows to its longest, 1,095 days, with its new last day',
    );
    await wars.getByRole('button', { name: 'Close' }).click();

    // An idle Rome has fallen by then, so the page plays the same world as Macedon.
    const tenYears = playAi(newGame(map, { seed: 5, player: 'rome' }), BEFORE_PERSIA_LEADS - 1);
    tenYears.player = 'macedon' as FactionId;
    await load(page, tenYears);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await untilDay(page, AFTER_THE_TIES, 0, 120_000);
    await pause(page);
    await page.getByRole('button', { name: 'Chronicle' }).click();
    const chronicle = page.getByTestId('chronicle');
    await chronicle
      .getByText(/is now the leading power/)
      .first()
      .scrollIntoViewIfNeeded();
    await shot(
      'leader-news',
      'Seed 5, Year 8, 150 days around a change of lead: each power that takes the lead is told once, and a lead that comes back through a tie is not told again',
    );
  },
});
