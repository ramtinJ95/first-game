import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import {
  fitCamera,
  mapToScreen,
  panBy,
  wheelFactor,
  zoomAt,
  type Camera,
} from '../../../src/render/camera.ts';
import type { CityId, FactionId } from '../../../src/sim/ids.ts';
import { parseMap } from '../../../src/sim/map.ts';
import { newGame } from '../../../src/sim/new-game.ts';
import { decideAll } from '../../../src/sim/ai/decide.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { tick } from '../../../src/sim/tick.ts';
import { buildWorld } from '../../../src/sim/world/world.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { defineScenario } from '../scenario.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/map/map.json'), 'utf8')),
);
const viewport = { width: 1280, height: 720 };
const centre = { x: viewport.width / 2, y: viewport.height / 2 };
const CLIP_MS = 12_000;
const NOTCH = Math.log(wheelFactor(-100));
const CLOSEST = 4.2;
/** The pans are timed in a game the AI has played this long. */
const AI_DAYS = 300;

/** The part of the view that no panel covers, where the mouse can always reach the map. */
const SAFE = { left: 40, top: 90, right: 900, bottom: 690 } as const;

function safe({ x, y }: MapPoint): MapPoint {
  return {
    x: Math.min(SAFE.right, Math.max(SAFE.left, x)),
    y: Math.min(SAFE.bottom, Math.max(SAFE.top, y)),
  };
}

function cityPoint(id: string): MapPoint {
  const province = map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no province ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/** Drives the page with real mouse input and follows the page's camera with the same maths. */
function controls(page: Page) {
  let camera: Camera = fitCamera(viewport, map);
  return {
    screen: (point: MapPoint) => mapToScreen(camera, viewport, point),
    get scale() {
      return camera.scale;
    },
    async zoom(at: MapPoint, notches: number, pauseMs = 90) {
      await page.mouse.move(at.x, at.y);
      for (let i = 0; i < Math.abs(notches); i++) {
        const deltaY = notches > 0 ? -100 : 100;
        await page.mouse.wheel(0, deltaY);
        camera = zoomAt(camera, at, wheelFactor(deltaY), viewport, map);
        await page.waitForTimeout(pauseMs);
      }
    },
    async drag(from: MapPoint, to: MapPoint, steps = 15) {
      // A press and release that barely moves is a click, which would select a province.
      if (Math.hypot(to.x - from.x, to.y - from.y) < 8) return;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps });
      await page.mouse.up();
      camera = panBy(camera, to.x - from.x, to.y - from.y, viewport, map);
    },
    async bringToCentre(point: MapPoint) {
      await this.drag(this.screen(point), centre);
    },
    /**
     * Zooms out to the whole map, then in on `point` to about `scale`, and centres it.
     * The wheel and the drags stay inside `SAFE`, clear of the top bar and the side
     * panels, so every step reaches the map. The point is pulled to the centre between
     * steps, so it stays on screen.
     */
    async goTo(point: MapPoint, scale: number, pauseMs = 25) {
      await page.keyboard.press('Escape');
      const out = Math.ceil(Math.log(camera.scale / fitCamera(viewport, map).scale) / NOTCH);
      if (out > 0) await this.zoom(centre, -out, pauseMs);
      let notches = scale > camera.scale ? Math.round(Math.log(scale / camera.scale) / NOTCH) : 0;
      while (notches > 0) {
        const step = Math.min(3, notches);
        await this.zoom(safe(this.screen(point)), step, pauseMs);
        notches -= step;
        await this.pull(point);
      }
      await this.pull(point);
    },
    /** Drags so that `point` comes to the centre, starting from inside `SAFE`. */
    async pull(point: MapPoint) {
      const at = this.screen(point);
      const from = safe(at);
      await this.drag(from, { x: from.x + centre.x - at.x, y: from.y + centre.y - at.y });
    },
  };
}

async function dropSave(page: Page, text: string) {
  const dataTransfer = await page.evaluateHandle((save) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([save], 'save.json', { type: 'application/json' }));
    return transfer;
  }, text);
  await page.dispatchEvent('canvas', 'drop', { dataTransfer });
}

function distanceToFrame(x: number, y: number): number {
  let best = Infinity;
  const ring = map.extent;
  for (const [i, [ax, ay]] of ring.entries()) {
    const [bx, by] = ring[(i + 1) % ring.length] ?? ring[0] ?? [ax, ay];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** The village farthest from any city, among those well inside the map's frame. */
function remoteVillage(): MapPoint & { name: string } {
  let best: (MapPoint & { name: string; distance: number }) | undefined;
  for (const s of map.settlements) {
    if (s.rank !== 'village') continue;
    const [x, y] = s.at;
    if (distanceToFrame(x, y) < 150) continue;
    const distance = Math.min(
      ...map.provinces.map((p) => Math.hypot(p.city[0] - x, p.city[1] - y)),
    );
    if (!best || distance > best.distance) best = { x, y, name: s.name, distance };
  }
  if (!best) throw new Error('no village');
  return best;
}

function nearestTown(point: MapPoint): MapPoint & { name: string } {
  const towns = map.settlements.filter((s) => s.rank === 'town');
  const sorted = towns.sort(
    (a, b) =>
      Math.hypot(a.at[0] - point.x, a.at[1] - point.y) -
      Math.hypot(b.at[0] - point.x, b.at[1] - point.y),
  );
  const town = sorted[0];
  if (!town) throw new Error('no town');
  return { x: town.at[0], y: town.at[1], name: town.name };
}

/** The five regions the look is judged on, each at a regional, a middle, and the closest zoom. */
const REGIONS = [
  {
    name: 'alps',
    title: 'the Alps and the Po valley',
    views: [
      { at: { x: 2420, y: 1880 }, scale: 0.55 },
      { at: { x: 2330, y: 1870 }, scale: 1.4 },
      { at: { x: 2215, y: 1835 }, scale: CLOSEST },
    ],
  },
  {
    name: 'zagros',
    title: 'the Zagros and Mesopotamia',
    views: [
      { at: { x: 5560, y: 3280 }, scale: 0.55 },
      { at: { x: 5560, y: 3260 }, scale: 1.4 },
      { at: { x: 5760, y: 3230 }, scale: CLOSEST },
    ],
  },
  {
    name: 'nile',
    title: 'the Nile from the delta to Thebai, with the desert on both sides',
    views: [
      { at: { x: 4150, y: 3980 }, scale: 0.55 },
      { at: { x: 4170, y: 4000 }, scale: 1.05 },
      { at: { x: 4170, y: 3990 }, scale: CLOSEST },
    ],
  },
  {
    name: 'gaul',
    title: 'Gaul and the Rhine with its forests',
    views: [
      { at: { x: 2050, y: 1420 }, scale: 0.55 },
      { at: { x: 2250, y: 1400 }, scale: 1.4 },
      { at: { x: 2330, y: 1330 }, scale: CLOSEST },
    ],
  },
  {
    name: 'greece',
    title: 'Greece and the Aegean',
    views: [
      { at: { x: 3520, y: 2800 }, scale: 0.55 },
      { at: { x: 3390, y: 2760 }, scale: 1.4 },
      { at: { x: 3300, y: 2650 }, scale: CLOSEST },
    ],
  },
] as const;
const ZOOM_NAMES = ['regional', 'middle', 'closest'] as const;

/** A game the faction AI has played for `days`, so the pans draw a world at war. */
function aiGame(days: number): GameState {
  const world = buildWorld(map);
  let state = newGame(map, { seed: 7, player: 'rome' });
  for (let n = 0; n < days; n++) state = tick(state, decideAll(state, world), world).state;
  return state;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
}

export default defineScenario({
  name: 'map',
  title:
    'The atlas map: zoom from the whole map into Italy, down to a town in the Apennines, hold while the smoke and the sea move, then pan along the range',
  viewport,
  async run({ page, shot: take }) {
    /** Takes a shot once every chunk of terrain in view is built and has faded in. */
    const shot = async (name: string, title: string) => {
      await frames(page);
      await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 60_000 });
      await take(name, title);
    };
    const started = Date.now();
    await page.goto('/');
    await page.getByTestId('time-controls').waitFor({ state: 'visible' });
    await frames(page);
    await page.waitForTimeout(600);
    await shot(
      'whole-map',
      'The widest zoom shows the whole map, from Britain to the Iranian plateau, with its ranges, deserts, and woods',
    );

    const camera = controls(page);
    await camera.zoom(camera.screen({ x: 2650, y: 2500 }), 6, 120);
    await camera.bringToCentre({ x: 2620, y: 2480 });
    await frames(page);
    await page.waitForTimeout(300);
    await shot('italy', `Italy at ${camera.scale.toFixed(2)} px per km, the same view as before`);

    const town = nearestTown({ x: 2585, y: 2300 });
    await camera.zoom(camera.screen(town), 10, 70);
    await camera.pull(town);
    await page.waitForTimeout(3000);
    await shot('closest-town', `The closest zoom on ${town.name}, a town in the Apennines`);
    for (let n = 0; n < 3; n++) {
      await camera.drag({ x: 1040, y: 560 }, { x: 640, y: 160 }, 25);
    }
    await frames(page);
    await shot('apennines-pan', 'After a pan south-east along the Apennines at the closest zoom');

    await camera.goTo({ x: 2620, y: 2480 }, 0.55);
    const syracusae = camera.screen(cityPoint('syracusae'));
    await page.mouse.click(syracusae.x, syracusae.y);
    await page.getByTestId('city-name').filter({ hasText: 'Syracusae' }).waitFor();
    await frames(page);
    await shot(
      'selected-province',
      'Syracusae selected: its outline is inked and the city panel shows the city, its owner, and its defences',
    );

    const state = newGame(map, { seed: 1, player: 'rome' });
    const city = state.cities['syracusae' as CityId];
    if (!city) throw new Error('new game lacks Syracusae');
    city.owner = 'rome' as FactionId;
    await dropSave(page, saveGame(state));
    await page.getByTestId('city-owner').filter({ hasText: 'Rome' }).waitFor();
    await page.waitForTimeout(400);
    await shot(
      'owner-changed',
      'After a save in which Rome holds Syracusae is dropped on the page, Sicily takes the Roman wash',
    );
    await page.keyboard.press('Escape');
    await page.getByTestId('city-name').waitFor({ state: 'hidden' });

    for (const region of REGIONS) {
      for (const [index, view] of region.views.entries()) {
        await camera.goTo(view.at, view.scale);
        await frames(page);
        await page.waitForTimeout(700);
        await shot(
          `${region.name}-${ZOOM_NAMES[index]}`,
          `${region.title[0]?.toUpperCase()}${region.title.slice(1)}, ${ZOOM_NAMES[index]} zoom, ${camera.scale.toFixed(2)} px per km`,
        );
      }
    }

    await camera.goTo({ x: 2560, y: 2350 }, 1.25);
    await page.waitForTimeout(700);
    await shot(
      'roman-italy-middle',
      `Roman Italy, the player's own land, at a middle zoom, ${camera.scale.toFixed(2)} px per km`,
    );

    await camera.goTo({ x: 6150, y: 3150 }, 0.62);
    await page.waitForTimeout(500);
    await shot('persia', `Persia and the Iranian plateau at ${camera.scale.toFixed(2)} px per km`);

    await camera.goTo(cityPoint('roma'), CLOSEST);
    await page.waitForTimeout(700);
    await shot(
      'closest-roma',
      `The closest zoom, ${camera.scale.toFixed(1)} px per km, on Roma, its fields, and the Roman army's banner`,
    );

    const village = remoteVillage();
    await camera.goTo(village, CLOSEST);
    await page.waitForTimeout(700);
    await shot(
      'closest-village',
      `The closest zoom on ${village.name}, the village farthest from any city`,
    );

    // The capture records the clip with a screenshot every 125 ms for its first 12 s,
    // which would slow every frame, so the measurement waits until it has stopped.
    await page.waitForTimeout(Math.max(0, CLIP_MS + 1000 - (Date.now() - started)));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const taskSeconds = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? NaN;
    };
    const collector = 'frameGaps';
    const sweep = [
      [1000, 360, 200, 360],
      [640, 600, 640, 120],
      [200, 360, 1000, 360],
      [200, 360, 1000, 360],
      [640, 120, 640, 600],
      [640, 120, 640, 600],
      [1000, 360, 200, 360],
      [1000, 360, 200, 360],
    ] as const;
    const lines: string[] = [];
    const war = aiGame(AI_DAYS);
    await dropSave(page, saveGame(war));
    await page.waitForFunction(
      (day) =>
        Number(
          document.querySelector('[data-testid="time-controls-day"]')?.getAttribute('data-day'),
        ) >= day,
      war.day,
    );
    const pans = [
      { name: 'widest', at: { x: map.width / 2, y: map.height / 2 }, scale: 0.17 },
      { name: 'middle', at: { x: 2600, y: 2200 }, scale: 1.0 },
      { name: 'closest', at: { x: 2420, y: 1880 }, scale: CLOSEST },
    ] as const;
    for (const pan of pans) {
      await camera.goTo(pan.at, pan.scale);
      await page.waitForTimeout(1500);
      await page.evaluate((key) => {
        const gaps: number[] = [];
        Reflect.set(globalThis, key, gaps);
        let last = performance.now();
        const step = (now: number) => {
          gaps.push(now - last);
          last = now;
          if (Reflect.get(globalThis, key) === gaps) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, collector);
      const busyBefore = await taskSeconds();
      for (const [x0, y0, x1, y1] of sweep) {
        await camera.drag({ x: x0, y: y0 }, { x: x1, y: y1 }, 40);
      }
      const busy = ((await taskSeconds()) - busyBefore) * 1000;
      const recorded = await page.evaluate((key) => {
        const gaps: unknown = Reflect.get(globalThis, key);
        Reflect.deleteProperty(globalThis, key);
        return Array.isArray(gaps) ? (gaps as number[]) : [];
      }, collector);
      const gaps = recorded.slice(1).sort((a, b) => a - b);
      const line =
        `${pan.name} pan, day ${AI_DAYS} of an AI game, at ${camera.scale.toFixed(2)} px per km: ${gaps.length} frames, ` +
        `main thread busy ${(busy / gaps.length).toFixed(1)} ms per frame, ` +
        `frame interval median ${percentile(gaps, 0.5).toFixed(1)} ms, p95 ${percentile(gaps, 0.95).toFixed(1)} ms`;
      console.log(line);
      lines.push(line);
    }
    await shot('pan-frame-time', lines.join('; '));
  },
});
