import { expect, type Page } from '@playwright/test';
import {
  camera,
  carthageNearsWar,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { rome } from '../../../e2e/support.ts';
import { troopsFor } from '../../../src/sim/troops.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

/** Shoots Roma's recruit cards at the size, scrolled into view in the side column or the sheet. */
async function cards(
  page: Page,
  shot: (name: string, title: string) => Promise<void>,
  size: string,
) {
  const cards = page.getByTestId('recruit-cards');
  await cards.scrollIntoViewIfNeeded();
  await shot(
    `recruit-threat-${size}`,
    `Carthage stands near war with Rome, and each troop Roma can raise says what its gold, then its men on their muster day, do to Carthage's share and whether it may still declare, at ${size === '1280' ? '1280 by 720' : '390 px wide, where the side column is a sheet'}`,
  );
}

export default defineScenario({
  name: 'recruit-threat',
  title:
    "While Carthage stands near war, Roma's recruit cards say what each troop does to its threat, once paid and once mustered",
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
    const at = cityPoint('roma');
    const point = camera(page).screen({ x: at.x, y: at.y + 40 });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    await expect(page.getByTestId('recruit-threat')).toHaveCount(troopsFor(rome).length);
    await expect(page.getByTestId('recruit-threat').first()).toContainText(/^Carthage \d+% now, /);
    await cards(page, shot, '1280');
    await resizeTo(page, PHONE);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    await expect(page.getByTestId('recruit-threat')).toHaveCount(troopsFor(rome).length);
    await cards(page, shot, '390');
    await resizeTo(page, WIDE);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    await resume(page);
    const hint = page.getByTestId('recruit-threat-paused');
    await expect(hint).toHaveText(
      'Pause the game to see what each troop does to the threat of Carthage.',
    );
    await expect(page.getByTestId('recruit-threat')).toHaveCount(0);
    await hint.scrollIntoViewIfNeeded();
    await pause(page);
    await expect(page.getByTestId('recruit-threat')).toHaveCount(troopsFor(rome).length);
    await resume(page);
    await hint.scrollIntoViewIfNeeded();
    await shot(
      'recruit-threat-running',
      'While the clock runs, a line above the cards says to pause to see what each troop does to the threat, at 1280 by 720',
    );
  },
});
