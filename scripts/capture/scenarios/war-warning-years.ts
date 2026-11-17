import { expect } from '@playwright/test';
import { alertsOfDay, type Alert } from '../../../src/app/alerts.ts';
import { pageData } from '../../../src/app/page.ts';
import { threatFadedNewsOfDay, threatNewsOfDay } from '../../../src/app/threat-news.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { dropSave, openGame, pause, untilDrawn } from '../../../e2e/support.ts';
import { playCautiousRome, world } from '../../cautious-rome.ts';
import { defineScenario } from '../scenario.ts';

const SEED = 5;
const DAYS = 3 * 365 + 180;

/**
 * The cautious Rome of `npm run sim -- threat -- --peaceful` on seed 5 to Year 4, day 180,
 * saved with a chronicle of every war warning the page's own rule told it, every line that a
 * warned threat has passed, and every declaration of war on it, newest first, as the page keeps them.
 */
function cautiousRomeWithItsWarnings(): string {
  const told = new Set<string>();
  const chronicle: Alert[] = [];
  let state: GameState | undefined;
  playCautiousRome(
    SEED,
    4,
    ({ before, after, events }) => {
      if (before.day >= DAYS) return;
      chronicle.unshift(
        ...threatFadedNewsOfDay(before, after, world, told),
        ...threatNewsOfDay(before, after, world, told),
        ...alertsOfDay(before, after, events).filter((alert) => alert.kind === 'warDeclared'),
      );
      if (after.day === DAYS) state = after;
    },
    { peaceful: true },
  );
  if (!state) throw new Error(`Rome fell before day ${DAYS}`);
  return saveGame(
    state,
    pageData({
      chronicle,
      camera: undefined,
      selection: undefined,
      panel: 'chronicle',
      occupied: new Map(),
      told,
      weakSieges: new Map(),
    }),
  );
}

export default defineScenario({
  name: 'war-warning-years',
  title:
    'A cautious Rome that trades, hires no guards and declares no war, over its first four years: the war warnings and the lines that each passed, in its chronicle',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    await dropSave(page, cautiousRomeWithItsWarnings());
    const chronicle = page.getByTestId('chronicle');
    await expect(chronicle).toBeVisible();
    await expect(chronicle.getByText(/threat has passed for now/)).toHaveCount(2);
    await untilDrawn(page);
    await shot(
      'war-warning-years-chronicle',
      'Every war warning a cautious Rome hears in its first four years on seed 5, and each line that the threat passed, newest first',
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(chronicle).toBeHidden();
    await shot('war-warning-years-corner', 'The news corner on Year 4, day 180');
  },
});
