import { expect } from '@playwright/test';
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
import { tick } from '../../../src/sim/tick.ts';
import { fixtureWorld } from '../../../src/sim/fixture.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'unpaid-order',
  title:
    'Rome orders Citizen rolls, then accepts a peace that asks for the gold the study took: the peace is not made, and the news says what it cost and what the treasury held',
  async run({ page, shot }) {
    await openGame(page);
    await resizeTo(page, { width: 1280, height: 720 });
    const before = carthageDemandsPeace();
    const gold = before.factions[rome]?.stores.gold ?? 0;
    const asked = gold - ADVANCES.citizenRolls.gold + 500;
    const offered = tick(
      before,
      [
        {
          kind: 'offerPeace',
          faction: carthage,
          to: rome,
          terms: { kind: 'payment', payer: rome, gold: asked, cities: [] },
        },
      ],
      fixtureWorld(),
    );
    expect(offered.rejected).toEqual([]);
    const state = offered.state;
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await page.getByTestId('advances-button').click();
    await page.getByTestId('study-citizenRolls').click();
    await page.getByTestId('advances-button').click();
    await page.getByTestId('wars-button').click();
    await page.getByTestId('accept-peace').click();
    await page.getByTestId('wars-button').click();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('The peace with Carthage was not made');
    await pause(page);
    await shot(
      'unpaid-order-news',
      'At 1280 by 720, the day after Rome ordered Citizen rolls and then accepted a peace asking for more than the study left: the news says the peace was not made, its price, and the gold held after Citizen rolls',
    );
  },
});
