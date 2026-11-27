import { expect, type Page } from '@playwright/test';
import {
  carthage,
  carthageDemandsPeace,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import { ADVANCES } from '../../../src/sim/advances/advances.ts';
import { fixtureWorld } from '../../../src/sim/fixture.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import type { PeaceTerms } from '../../../src/sim/state/peace.ts';
import { tick } from '../../../src/sim/tick.ts';
import { defineScenario } from '../scenario.ts';

/** Carthage holds Capua and asks Rome for 500 gold more than Rome holds once Citizen rolls is paid. */
function demand(): { state: GameState; terms: PeaceTerms } {
  const before = carthageDemandsPeace();
  const gold = before.factions[rome]?.stores.gold ?? 0;
  const terms: PeaceTerms = {
    kind: 'payment',
    payer: rome,
    gold: gold - ADVANCES.citizenRolls.gold + 500,
    cities: [],
  };
  const offered = tick(
    before,
    [{ kind: 'offerPeace', faction: carthage, to: rome, terms }],
    fixtureWorld(),
  );
  expect(offered.rejected).toEqual([]);
  return { state: offered.state, terms };
}

async function load(page: Page, save: string, day: number) {
  await pause(page);
  await dropSave(page, save);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', String(day));
  await untilDrawn(page);
}

export default defineScenario({
  name: 'unpaid-order',
  title:
    'After Rome orders Citizen rolls, the wars panel will not let it accept a peace that asks for the gold the study took; a save whose accepted peace the treasury cannot pay tells why in the news',
  async run({ page, shot }) {
    await openGame(page);
    await resizeTo(page, { width: 1280, height: 720 });
    const { state, terms } = demand();
    await load(page, saveGame(state), state.day);
    await page.getByTestId('advances-button').click();
    await page.getByTestId('study-citizenRolls').click();
    await page.getByTestId('advances-button').click();
    await page.getByTestId('wars-button').click();
    const wars = page.getByTestId('wars-panel');
    await expect(wars.getByTestId('accept-peace')).toBeDisabled();
    await expect(wars).toContainText('once the orders given today are paid');
    await shot(
      'unpaid-order-wars',
      "At 1280 by 720, with Citizen rolls ordered, the wars panel counts the 3,000 gold promised to it: Carthage's demand cannot be met, and Accept peace is disabled",
    );
    await page.getByTestId('wars-button').click();

    const poorer = structuredClone(state);
    const stores = poorer.factions[rome]?.stores;
    if (!stores) throw new Error('no Roman stores');
    stores.gold -= ADVANCES.citizenRolls.gold;
    const save = saveGame(poorer, {
      paused: true,
      pendingPeace: [{ kind: 'acceptPeace', faction: rome, from: carthage, terms }],
      chronicle: [],
      occupied: [],
      told: [],
      weakSieges: [],
    });
    await load(page, save, poorer.day);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('The peace with Carthage was not made');
    await pause(page);
    await shot(
      'unpaid-order-news',
      'At 1280 by 720, the day after a loaded save accepted a peace the treasury could no longer pay: the news says the peace was not made, its price, and the gold held',
    );
  },
});
