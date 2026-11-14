import { expect, type Page } from '@playwright/test';
import {
  dropSave,
  openGame,
  pause,
  resume,
  siegeToEndInPeace,
  untilDrawn,
} from '../../../e2e/support.ts';
import { peaceStanding, stalePeaceForecast } from '../../../e2e/peace-support.ts';
import { warKey } from '../../../src/sim/state/war.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

async function showWar(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
  const panel = page.getByTestId('wars-panel');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('open-wars').click();
  }
  return panel;
}

export default defineScenario({
  name: 'peace-follows-war',
  title:
    'Peace follows the war: six standings, the live-forecast warning, and an actual refusal with its reason',
  viewport: { width: 1280, height: 900 },
  async run({ page, shot }) {
    await openGame(page);
    for (const enemy of ['mediolanum', 'macedon'] as const) {
      for (const score of [2, 0, -2] as const) {
        const panel = await showWar(page, peaceStanding(enemy, score));
        const status = score > 0 ? 'winning' : score < 0 ? 'losing' : 'even';
        await expect(panel.getByTestId('war-summary')).toContainText(
          score > 0 ? 'your way (+2)' : score < 0 ? 'against you (-2)' : 'stands even (0)',
        );
        await expect(panel.getByTestId('peace-verdict')).toContainText(
          score < 0 ? 'would refuse' : 'would accept',
        );
        if (score > 0) await expect(panel).toContainText('cannot demand payment while losing +9');
        await shot(
          `${enemy}-${status}`,
          `Rome ${status} against ${enemy === 'mediolanum' ? 'the minor Mediolanum' : 'the great power Macedon'}: ${score === 0 ? '225-day even war ends as things stand' : `day 65, standing ${score > 0 ? '+' : ''}${score}`}, with the answer and every factor`,
        );
      }
    }

    const panel = await showWar(page, siegeToEndInPeace());
    await expect(panel.getByTestId('peace-forecast-warning')).toBeVisible();
    await shot(
      'live-forecast',
      'Carthago is under siege: the panel warns that the next-day answer may change with the battle or siege',
    );
    await panel.getByLabel('Carthage pays you').check();
    await panel.getByTestId('peace-gold').fill('3000');
    await panel.getByTestId('offer-peace').click();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Carthage refused your offer of peace');
    await pause(page);
    await expect(page.getByTestId('alerts')).toContainText(/It wants terms worth \d+ points more/);
    await shot(
      'refusal-reason',
      'An actual next-day refusal remains in the alerts and Chronicle with the amount still wanted, rather than silently clearing the offer',
    );

    const stale = stalePeaceForecast();
    const sent = stale.peaceOffers[warKey(stale.player, 'macedon' as FactionId)];
    if (sent?.terms.kind !== 'payment') throw new Error('the stale offer must carry a payment');
    const changed = await showWar(page, stale);
    await changed.getByLabel('You pay Macedon').check();
    await changed.getByTestId('peace-gold').fill(String(sent.terms.gold));
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      'The forecast changed: battle losses changed',
    );
    await pause(page);
    await changed.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(page.getByTestId('chronicle')).toContainText('its war standing changed from');
    await shot(
      'changed-forecast',
      'Macedon had accepted the forecast of 800 gold, but real battle losses at Ariminum raised its next-day price: the refusal names the changed losses and standing',
    );
  },
});
