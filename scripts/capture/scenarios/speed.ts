import type { Page } from '@playwright/test';
import {
  camera,
  cityPoint,
  greatBattle,
  hundredArmies,
  pause,
  playAi,
  playDays,
  startGame,
} from '../../../e2e/support.ts';
import { loadSave, stillAfter } from '../../../e2e/watch.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

/** The recorded clip takes a screenshot every 125 ms for 12 s, which slows every frame. */
const CLIP_MS = 12_000;

/**
 * Main thread time per frame while the map is panned to and fro, from the browser's own
 * task accounting, with the number of sprites the armies layer drew.
 */
async function measure(page: Page, label: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const busy = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const value = (name: string) => metrics.find((m) => m.name === name)?.value ?? NaN;
    return { task: value('TaskDuration'), script: value('ScriptDuration') };
  };
  const count = async () => {
    const rendered = await page.getByTestId('map').getAttribute('data-figures');
    return Number(rendered ?? 0);
  };
  await page.evaluate(() => {
    const frames = { count: 0 };
    Reflect.set(globalThis, 'measuredFrames', frames);
    const step = () => {
      frames.count++;
      if (Reflect.get(globalThis, 'measuredFrames') === frames) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const sprites = await count();
  const before = await busy();
  for (const [x0, x1] of [
    [900, 380],
    [380, 900],
    [900, 380],
    [380, 900],
  ] as const) {
    await page.mouse.move(x0, 360);
    await page.mouse.down();
    await page.mouse.move(x1, 360, { steps: 30 });
    await page.mouse.up();
  }
  const after = await busy();
  const task = after.task - before.task;
  const script = after.script - before.script;
  const frames = await page.evaluate(() => {
    const frames = Reflect.get(globalThis, 'measuredFrames') as { count: number };
    Reflect.deleteProperty(globalThis, 'measuredFrames');
    return frames.count;
  });
  const perFrame = (seconds: number) => ((seconds * 1000) / Math.max(1, frames)).toFixed(1);
  const summary = `${label}: ${sprites} figures drawn, ${frames} frames while panning, main thread busy ${perFrame(task)} ms per frame, of which script ${perFrame(script)} ms`;
  console.log(summary);
  return summary;
}

async function zoomOn(
  page: Page,
  state: GameState,
  point: { x: number; y: number },
  notches: number,
) {
  await page.goto('/');
  await page.getByTestId('top-bar').waitFor({ state: 'visible' });
  await pause(page);
  await loadSave(page, state);
  const view = camera(page);
  await view.closeUp(point, notches);
  await page.waitForTimeout(1500);
  return view;
}

export default defineScenario({
  name: 'speed',
  title:
    'Frame cost: a year of an AI game at a middle zoom, a hundred armies in view, and a battle of two full armies at the closest zoom',
  async run({ page, shot }) {
    const started = Date.now();
    const late = playAi(startGame(), 365);
    const roma = cityPoint('roma');
    await zoomOn(page, late, roma, 9);
    await shot(
      'speed-ai-year',
      'Day 366 of a game the AI played: every army Rome sees at a middle zoom',
    );
    await page.waitForTimeout(Math.max(0, CLIP_MS + 1000 - (Date.now() - started)));
    const aiYear = await measure(page, 'A year into an AI game, middle zoom over Italy');

    await zoomOn(page, hundredArmies(), roma, 9);
    await shot('speed-hundred', 'A hundred armies of four formations in view at a middle zoom');
    const hundred = await measure(page, 'A hundred armies of four formations, middle zoom');

    const battle = greatBattle();
    await zoomOn(page, battle, { x: roma.x + 100, y: roma.y - 8 }, 17);
    await stillAfter(page, playDays(battle, 1), 1500);
    await shot(
      'speed-battle',
      'Two armies of eight formations of 1,500 men in battle at the closest zoom',
    );
    const great = await measure(
      page,
      'A battle of two armies of eight full formations, closest zoom',
    );
    await shot('speed-numbers', [aiYear, hundred, great].join('; '));
  },
});
