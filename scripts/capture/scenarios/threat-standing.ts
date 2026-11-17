import { expect } from '@playwright/test';
import {
  carthage,
  carthageNearsWar,
  declareWar,
  dropSave,
  openGame,
  pause,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { CityId } from '../../../src/sim/ids.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'threat-standing',
  title:
    'At peace with every power, the wars panel says how near each great power stands to declaring war on Rome, and at war with a minor city it opens on the power near war',
  async run({ page, shot }) {
    await openGame(page);
    const state = carthageNearsWar();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await page.getByTestId('wars-button').click();
    const rows = page.getByTestId('wars-panel').getByTestId('threat-row');
    await expect(rows.filter({ hasText: /^Carthage has \d+% of the strength/ })).toHaveCount(1);
    await expect(rows).toHaveCount(4);
    await shot(
      'threat-standing-panel',
      "Carthage, grown to twelve cities, stands near the strength it needs against Rome, and the other powers stand further off, each with what Rome's treasury and guards do",
    );
    await page.getByTestId('wars-button').click();
    const atWar = carthageNearsWar();
    const mediolanum = atWar.cities['mediolanum' as CityId];
    const punic = atWar.factions[carthage];
    if (!mediolanum || !punic) throw new Error('no Mediolanum or Carthage');
    declareWar(atWar, rome, mediolanum.owner);
    punic.noticeSince = atWar.day;
    await dropSave(page, atWar);
    await untilDrawn(page);
    await page.getByTestId('wars-button').click();
    await expect(rows.first()).toContainText('Carthage has');
    await shot(
      'threat-standing-at-war',
      'At war with Mediolanum and with Carthage on notice, the wars panel opens on Carthage first in At peace, above the war',
    );
  },
});
