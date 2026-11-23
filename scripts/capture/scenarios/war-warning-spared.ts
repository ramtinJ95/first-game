import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  carthageWarnsAgain,
  CARTHAGE_STOPPED_ON,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import { dateText } from '../../../src/app/names.ts';
import type { FormationId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

/** Carthage presses Rome's 1,000 men in the field with 2,000, as `paused-news-fits` plays it. */
function carthagePresses(): GameState {
  const state = carthageNearsWar();
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  if (!punic || !roman) throw new Error('no armies');
  punic.men = 2000;
  roman.men = 1000;
  return state;
}

/** The warnings that run the game on, with the stop each repeats. */
const REPEATS = [
  {
    name: 'a warning by a city',
    save: () => carthageWarnsAgain(100),
    line: /could soon declare war on you.*near Roma.*The game ran on/,
    says: `The game ran on: its stop on ${dateText(CARTHAGE_STOPPED_ON)} was at 100%, and it stands no higher.`,
    shot: 'corner',
  },
  {
    name: 'a warning by field armies',
    save: () => carthageWarnsAgain(100, { state: carthagePresses(), front: 'field' }),
    line: /could soon declare war on you.*against your field armies.*The game ran on/,
    says: 'against your field armies, ',
  },
] as const;

/** Plays the save until the corner tells the line, at the first speed so it is still among the newest when the pause lands. */
async function warnAgain(page: Page, save: string, line: RegExp, says: string) {
  await pause(page);
  await dropSave(page, save);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '300');
  await untilDrawn(page);
  await page.getByRole('button', { name: 'Speed 1', exact: true }).click();
  await resume(page);
  const alerts = page.getByTestId('alerts');
  const item = alerts.getByRole('listitem').filter({ hasText: line });
  await item.waitFor();
  await pause(page);
  await expect(item.getByTestId('alert-paused')).toHaveCount(0);
  await expect(item).toContainText(says);
  await item.scrollIntoViewIfNeeded();
  await untilDrawn(page);
  return { alerts, item };
}

export default defineScenario({
  name: 'war-warning-spared',
  title:
    "A great power's warning soon after it stopped the game, no higher and at the same front, runs the game on and says why, read whole in the corner at 1280 × 720 and 1024 × 720, and in the At peace list",
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1024, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await resizeTo(page, viewport);
      for (const repeat of REPEATS) {
        if (viewport.width < 720 && !('shot' in repeat)) continue;
        const { alerts, item } = await warnAgain(page, repeat.save(), repeat.line, repeat.says);
        if (viewport.width >= 720) {
          const box = await item.boundingBox();
          const list = await alerts.boundingBox();
          if (!box || !list) throw new Error('no alert or corner');
          expect(box.y, `${repeat.name} starts inside the corner`).toBeGreaterThanOrEqual(
            list.y - 0.5,
          );
          expect(box.y + box.height, `${repeat.name} ends inside the corner`).toBeLessThanOrEqual(
            list.y + list.height + 0.5,
          );
        }
        if (!('shot' in repeat) || viewport.width === 1024) continue;
        await shot(
          `${repeat.shot}-${viewport.width}`,
          `${viewport.width} wide: Carthage warns again 56 days after it stopped the game, no higher, so the game ran on, and the line says why`,
        );
        await page.getByTestId('wars-button').click();
        const row = page
          .getByTestId('wars-panel')
          .getByTestId('threat-row')
          .filter({ hasText: 'Carthage has' });
        await expect(row).toContainText(
          `the game ran on: its stop on ${dateText(CARTHAGE_STOPPED_ON)} was at 100%.`,
        );
        await row.scrollIntoViewIfNeeded();
        await untilDrawn(page);
        await shot(
          `at-peace-${viewport.width}`,
          `${viewport.width} wide: the At peace list says Carthage warned again and the game ran on, with the stop it ran on from`,
        );
        await page.getByTestId('wars-button').click();
      }
    }
  },
});
