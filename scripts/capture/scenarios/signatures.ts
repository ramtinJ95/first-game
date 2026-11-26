import { expect } from '@playwright/test';
import {
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  romaWithEveryBuilding,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'signatures',
  title:
    "Each great power's standing bonus on the start screen, and Roma's panel offering Rome's own building, the Colonia, with its price, days and payback",
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    await page.goto('/');
    await page.getByTestId('start-screen').waitFor();
    await expect(page.getByTestId('power-bonus-persia')).toContainText('Satrapies');
    await shot(
      'start-bonuses',
      'The start screen: each power card ends with its standing bonus in one line',
    );

    await openGame(page);
    const state = romaWithEveryBuilding();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    const at = cityPoint('roma');
    const point = camera(page).screen({ x: at.x, y: at.y + 40 });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    const own = page.getByTestId('build-signature');
    await expect(own).toContainText('Colonia');
    await own.scrollIntoViewIfNeeded();
    await shot(
      'colonia-offered',
      "Roma's panel offers Rome's own building under Your own building: the Colonia, with what it does, its price, its days and its payback",
    );
  },
});
