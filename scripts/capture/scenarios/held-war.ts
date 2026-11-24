import { expect, type Page } from '@playwright/test';
import { carthageHeldByLepcis } from '../../../e2e/held-war-game.ts';
import { dropSave, openGame, pause, resizeTo, resume, untilDrawn } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

const CASES = [
  {
    name: 'warning',
    title:
      'a warning of Carthage, held back by its war with Lepcis Magna, names the war and the share it would stand at once it ends',
    play: 'warning',
    line: /Its war with Lepcis Magna holds back part of its strength: once that war ends, it would stand at \d+%/,
    stops: true,
  },
  {
    name: 'ended',
    title:
      'the war with Lepcis Magna ends while Carthage stands on notice: told, and the game runs on',
    play: 'ends',
    line: /Carthage's war with Lepcis Magna has ended, and no longer holds back its strength: it stands at/,
    stops: false,
  },
  {
    name: 'ended-climb',
    title:
      'the war ends and Carthage climbs more than 6 points above its last stop: one stop that tells both',
    play: 'climbs',
    line: /Carthage's war with Lepcis Magna has ended\. Carthage stands higher than when the game last stopped for it/,
    stops: true,
  },
] as const;

/**
 * The case's line stands whole inside the window and inside the list that clips it, once the
 * list is scrolled to it.
 */
async function whole(page: Page, line: RegExp) {
  const window = page.viewportSize();
  const list = page.getByTestId('alerts');
  const item = list.getByRole('listitem').filter({ hasText: line }).first();
  await item.waitFor();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  const room = await list.boundingBox();
  expect(box).not.toBeNull();
  expect(room).not.toBeNull();
  if (!box || !room || !window) return;
  expect(box.y).toBeGreaterThanOrEqual(Math.max(0, room.y) - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(window.width);
  expect(box.y + box.height).toBeLessThanOrEqual(Math.min(window.height, room.y + room.height) + 1);
}

export default defineScenario({
  name: 'held-war',
  title:
    'A power on notice held back by a war: the warning names the war and the share once it ends, and the day it ends is told, in the stop when the power climbs 6 points with it; at 1280 and 1024 in the corner, and at 390 in the Chronicle',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 720 });
      for (const c of CASES) {
        await pause(page);
        await dropSave(page, carthageHeldByLepcis(c.play));
        await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
        await untilDrawn(page);
        await resume(page);
        const item = page.getByTestId('alerts').getByRole('listitem').filter({ hasText: c.line });
        await item.first().waitFor();
        if (c.stops) await expect(item.first().getByTestId('alert-paused')).toHaveCount(1);
        else await expect(item.first().getByTestId('alert-paused')).toHaveCount(0);
        await pause(page);
        await untilDrawn(page);
        await whole(page, c.line);
        await shot(`held-war-${c.name}-${width}`, `${width} × 720: ${c.title}`);
      }
    }
    await resizeTo(page, { width: 390, height: 844 });
    const toggle = page.getByRole('button', { name: 'Chronicle' });
    for (const c of CASES) {
      await pause(page);
      await dropSave(page, carthageHeldByLepcis(c.play));
      await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', '100');
      await untilDrawn(page);
      await resume(page);
      await page
        .getByTestId('alerts')
        .getByRole('listitem')
        .filter({ hasText: c.line })
        .first()
        .waitFor();
      await pause(page);
      await toggle.click();
      await inChronicle(page, c.line);
      await untilDrawn(page);
      await shot(`held-war-${c.name}-chronicle-390`, `390 × 844, in the Chronicle: ${c.title}`);
      await toggle.click();
    }
  },
});

/** The case's line stands whole in the Chronicle at 390 px, inside its list and the window, once scrolled to. */
async function inChronicle(page: Page, line: RegExp) {
  const window = page.viewportSize();
  const list = page.getByTestId('chronicle').getByRole('list');
  const item = list.getByRole('listitem').filter({ hasText: line }).first();
  await item.waitFor();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  const room = await list.boundingBox();
  expect(box).not.toBeNull();
  expect(room).not.toBeNull();
  if (!box || !room || !window) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(window.width);
  expect(box.y).toBeGreaterThanOrEqual(room.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(Math.min(window.height, room.y + room.height) + 1);
}
