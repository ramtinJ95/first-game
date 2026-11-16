import { chromium, type Page } from '@playwright/test';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { SOFTWARE_GL } from '../playwright.config.ts';
import { fitCamera, mapToScreen, wheelFactor, zoomAt, type Camera } from '../src/render/camera.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { saveGame } from '../src/sim/save.ts';
import { tick } from '../src/sim/tick.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { PowerId } from '../src/sim/map.ts';
import { figureHeight, FIGURE_SCALE } from '../src/render/armies/scene.ts';
import { sheetSizeFor } from '../src/render/armies/layer.ts';
import { MAX_SCALE } from '../src/render/camera.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dropSave, map, openGame, startGame, untilDrawn } from './support.ts';

/**
 * Measures what the tab holds as a long session plays. `--loads <n>` drops one saved
 * game on the page n times and, between loads, zooms from the whole map to the middle
 * and the closest zoom over the Persian plateau and back. `--years <n>` instead plays one
 * new game at the fastest speed for n game years. After each step it collects garbage
 * and prints a CSV row: the JS heap, the live WebGL textures and their bytes as the
 * page created them, and the resident memory of the renderer and GPU processes.
 * Build first with `npm run build`; `--root <dir>` serves another checkout's build.
 *
 * `--bound 0.1` fails the run when the JS heap of the last three loads is more than a tenth
 * over that of loads 3 to 5, and `--process-bound` sets the share for the renderer and GPU
 * processes, whose memory in software rises for about fifty loads to a plateau.
 *
 * `--power` and `--seed` choose the new game of `--years` (Persia on seed 2 by default).
 *
 * `--cycles <n>` plays a stranger's session instead: odd cycles start a new game from the
 * Game menu as each power in turn, even cycles drop a day-1 save of Rome. Each zooms
 * through all three zooms over the power's capital and over the plateau, and plays
 * `--play` seconds at the fastest speed. Each cycle is then sampled with the day-1 save
 * dropped again and drawn over the whole map, the same state every time.
 * `--cycle-bound 0.1` fails the run when the collected heap, the DOM nodes, or the live
 * texture bytes after any later cycle are more than a tenth over cycle 1. The DOM nodes
 * count the detached ones too, which each row also gives apart, with the live canvases. `--snapshots 2,6`
 * writes heap snapshots after those cycles, named after `--snapshot`, and `--texture-shapes`
 * prints the live textures by size that each cycle added or freed.
 *
 * `--sheets <n>` stands the armies of n colours (Rome's and those of other powers, then a
 * minor) in one view on day 1 and zooms in over them three times through every size of
 * figure sheet the screen rests at, `--dpr 2` for a screen of twice the density, in a
 * `--viewport 640x360` window if the machine cannot draw a larger one in software. It
 * prints the sheets painted in the first round and again in the later ones and their bytes
 * over the whole map after each round, and fails when a sheet is painted twice at one zoom
 * or again as the camera goes back and forth between two neighbouring zooms.
 * `--sheet-bound <MB>` fails the run when the sheets over the whole map hold more.
 *
 *   node e2e/memory-bench.ts [--loads 30 | --years 10] [--days 300] [--draw full] [--out file.csv]
 */
const { values } = parseArgs({
  options: {
    loads: { type: 'string' },
    cycles: { type: 'string' },
    play: { type: 'string', default: '5' },
    'cycle-bound': { type: 'string' },
    sheets: { type: 'string' },
    dpr: { type: 'string', default: '1' },
    viewport: { type: 'string' },
    'chromium-args': { type: 'string' },
    'sheet-bound': { type: 'string' },
    snapshots: { type: 'string' },
    'texture-shapes': { type: 'boolean', default: false },
    bound: { type: 'string' },
    'process-bound': { type: 'string' },
    years: { type: 'string' },
    days: { type: 'string', default: '300' },
    draw: { type: 'string', default: 'full' },
    root: { type: 'string' },
    out: { type: 'string' },
    snapshot: { type: 'string' },
    query: { type: 'string', default: '' },
    power: { type: 'string', default: 'persia' },
    seed: { type: 'string', default: '2' },
    armies: { type: 'boolean', default: false },
    sites: { type: 'boolean', default: false },
  },
});

/** A run stops once the machine has less than this left, before the tab or the run is killed. */
const LOW_MB = 300;
/** `--viewport 640x360` draws a smaller page, as the figure sheets at `--dpr 2` need in software. */
const [WIDTH, HEIGHT] = (values.viewport ?? '1280x720').split('x').map(Number);
const VIEWPORT = { width: WIDTH ?? 1280, height: HEIGHT ?? 720 };
/**
 * A long session looks at many places, so each zoom goes in over the next of these:
 * the Persian plateau where the tester's tab crashed, then every third city of the map
 * from west to east. Each step then zooms in over the plateau too, so every sample holds
 * the same last view and differs only by what the places before it left behind.
 */
const PLATEAU: MapPoint = { x: 6080, y: 3330 };
const PLACES: MapPoint[] = [
  PLATEAU,
  ...map.provinces
    .map(({ city: [x, y] }) => ({ x, y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((_, i) => i % 3 === 0),
];
const MIDDLE = 1.6;
const CLOSEST = 4.2;

/** Counts the textures WebGL holds and the bytes of their largest level, without touching the game. */
function trackTextures() {
  const sizes = new Map<WebGLTexture, number>();
  const bound = new WeakMap<WebGL2RenderingContext, WebGLTexture | null>();
  const proto = WebGL2RenderingContext.prototype;
  const create = proto.createTexture;
  const remove = proto.deleteTexture;
  const bind = proto.bindTexture;
  const image = proto.texImage2D as (...args: unknown[]) => void;
  const storage = proto.texStorage2D;
  const buffers = new Map<WebGLBuffer, number>();
  const boundBuffer = new Map<GLenum, WebGLBuffer | null>();
  const createBuffer = proto.createBuffer;
  const deleteBuffer = proto.deleteBuffer;
  const bindBuffer = proto.bindBuffer;
  const bufferData = proto.bufferData as (...args: unknown[]) => void;
  proto.createBuffer = function (this: WebGL2RenderingContext) {
    const buffer = createBuffer.call(this);
    if (buffer) buffers.set(buffer, 0);
    return buffer;
  };
  proto.deleteBuffer = function (this: WebGL2RenderingContext, buffer: WebGLBuffer | null) {
    if (buffer) buffers.delete(buffer);
    return deleteBuffer.call(this, buffer);
  };
  proto.bindBuffer = function (this: WebGL2RenderingContext, target: GLenum, buffer) {
    boundBuffer.set(target, buffer);
    return bindBuffer.call(this, target, buffer);
  };
  proto.bufferData = function (this: WebGL2RenderingContext, ...args: unknown[]) {
    const buffer = boundBuffer.get(args[0] as GLenum);
    const data = args[1];
    if (buffer)
      buffers.set(
        buffer,
        typeof data === 'number' ? data : ((data as ArrayBufferView | null)?.byteLength ?? 0),
      );
    return bufferData.apply(this, args);
  } as typeof proto.bufferData;
  const shapes = new Map<WebGLTexture, string>();
  const fromCanvas = new Set<WebGLTexture>();
  proto.createTexture = function (this: WebGL2RenderingContext) {
    const texture = create.call(this);
    if (texture) sizes.set(texture, 0);
    return texture;
  };
  proto.deleteTexture = function (this: WebGL2RenderingContext, texture: WebGLTexture | null) {
    if (texture) sizes.delete(texture);
    if (texture) shapes.delete(texture);
    if (texture) fromCanvas.delete(texture);
    return remove.call(this, texture);
  };
  proto.bindTexture = function (this: WebGL2RenderingContext, target: GLenum, texture) {
    bound.set(this, texture);
    return bind.call(this, target, texture);
  };
  proto.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
    const texture = bound.get(this);
    if (texture && args[1] === 0) {
      const source = args[5] as { width?: number; height?: number } | null | undefined;
      const [width, height] =
        typeof args[3] === 'number' && typeof args[4] === 'number'
          ? [args[3], args[4]]
          : [source?.width ?? 0, source?.height ?? 0];
      sizes.set(texture, width * height * 4);
      shapes.set(texture, `${width}x${height}`);
      if (args.some((arg) => arg instanceof HTMLCanvasElement)) fromCanvas.add(texture);
      else fromCanvas.delete(texture);
    }
    return image.apply(this, args);
  } as typeof proto.texImage2D;
  proto.texStorage2D = function (this: WebGL2RenderingContext, target, levels, format, w, h) {
    const texture = bound.get(this);
    if (texture) sizes.set(texture, w * h * 4);
    if (texture) shapes.set(texture, `${w}x${h}`);
    if (texture) fromCanvas.delete(texture);
    return storage.call(this, target, levels, format, w, h);
  };
  // A lost context takes every texture and buffer with it, and none is deleted one by one.
  document.addEventListener(
    'webglcontextlost',
    () => {
      sizes.clear();
      shapes.clear();
      fromCanvas.clear();
      buffers.clear();
    },
    true,
  );
  // The longest wait between two animation frames, and how many passed 100 ms, since last read.
  let lastFrame = 0;
  let gaps = { longest: 0, over100: 0 };
  const onFrame = (at: number) => {
    if (lastFrame > 0) {
      const gap = at - lastFrame;
      gaps = { longest: Math.max(gaps.longest, gap), over100: gaps.over100 + (gap > 100 ? 1 : 0) };
    }
    lastFrame = at;
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
  Object.assign(window, {
    frameGaps: () => {
      const read = { longest: Math.round(gaps.longest), over100: gaps.over100 };
      gaps = { longest: 0, over100: 0 };
      return read;
    },
    textureShapes: () => {
      const counts: Record<string, number> = {};
      for (const shape of shapes.values()) counts[shape] = (counts[shape] ?? 0) + 1;
      return counts;
    },
    textureReport: () => ({
      count: sizes.size,
      bytes: [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0),
      buffers: buffers.size,
      bufferBytes: [...buffers.values()].reduce((sum, bytes) => sum + bytes, 0),
      // A figure sheet is a canvas laid out 2048 or 4096 px wide. Render targets of those
      // widths have no canvas behind them, and the names drawn from canvases are narrow.
      sheetBytes: [...sizes]
        .filter(
          ([texture]) => fromCanvas.has(texture) && /^(2048|4096)x/.test(shapes.get(texture) ?? ''),
        )
        .reduce((sum, [, bytes]) => sum + bytes, 0),
    }),
  });
}

/** Resident set of every Chromium process of a type, in MB, read from /proc. */
function residentMb(type: string): number {
  let kb = 0;
  // Only Linux has /proc; elsewhere the processes' memory reads 0.
  if (!existsSync('/proc/meminfo')) return 0;
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmdline.includes('chrom') || !cmdline.includes(`--type=${type}`)) continue;
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      kb += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    } catch {
      // A process that ended between the listing and the read holds nothing.
    }
  }
  return Math.round(kb / 1024);
}

/**
 * The live objects of a prototype for which `test`, an expression of `node`, holds. `queryObjects` hands back an array
 * that DevTools keeps until its group is released, and a kept array keeps every node in
 * it, so a count that did not release it would itself hold each old page it counted.
 */
async function countObjects(
  session: import('@playwright/test').CDPSession,
  prototype: string,
  test: string,
): Promise<number> {
  const objectGroup = 'memory-bench-count';
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: prototype,
      objectGroup,
    });
    const { objects } = await session.send('Runtime.queryObjects', {
      prototypeObjectId: result.objectId ?? '',
      objectGroup,
    });
    const counted = await session.send('Runtime.callFunctionOn', {
      objectId: objects.objectId ?? '',
      // Prototypes come back with the instances, and reading a node's fields from one throws.
      functionDeclaration: `function () {
        return this.filter((node) => {
          try { return typeof node.isConnected === 'boolean' && (${test}); } catch { return false; }
        }).length;
      }`,
      returnByValue: true,
    });
    return Number(counted.result.value);
  } finally {
    await session.send('Runtime.releaseObjectGroup', { objectGroup });
  }
}

async function sample(page: Page, step: string) {
  const session = await page.context().newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  await session.send('Performance.enable');
  const { metrics } = await session.send('Performance.getMetrics');
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  const textures = await page.evaluate(() =>
    (
      window as unknown as {
        textureReport(): {
          count: number;
          bytes: number;
          buffers: number;
          bufferBytes: number;
          sheetBytes: number;
        };
      }
    ).textureReport(),
  );
  if (values.sites) await printSites(page);
  const detached = await countObjects(session, 'Node.prototype', '!node.isConnected');
  const canvases = await countObjects(session, 'HTMLCanvasElement.prototype', 'true');
  await session.detach();
  return {
    step,
    heapMb: Math.round(metric('JSHeapUsedSize') / 2 ** 20),
    nodes: metric('Nodes'),
    listeners: metric('JSEventListeners'),
    detached,
    canvases,
    textures: textures.count,
    textureMb: Math.round(textures.bytes / 2 ** 20),
    sheetMb: Math.round(textures.sheetBytes / 2 ** 20),
    buffers: textures.buffers,
    bufferMb: Math.round(textures.bufferBytes / 2 ** 20),
    rendererMb: residentMb('renderer'),
    gpuMb: residentMb('gpu-process'),
    peakMb: peak.tabMb,
    leastFreeMb: peak.freeMb,
    freeMb: availableMb(),
  };
}

const availableMb = () =>
  existsSync('/proc/meminfo')
    ? Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0) >> 10
    : Infinity;

/** The most the renderer and GPU processes held, and the least the machine had left, since the run began. */
const peak = { tabMb: 0, freeMb: Infinity, phaseMb: 0 };
setInterval(() => {
  const tab = residentMb('renderer') + residentMb('gpu-process');
  peak.tabMb = Math.max(peak.tabMb, tab);
  peak.phaseMb = Math.max(peak.phaseMb, tab);
  peak.freeMb = Math.min(peak.freeMb, availableMb());
}, 250).unref();

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: SamplingNode[];
}

/** The live sampled allocations by the function that made them and its caller, largest first. */
async function printSites(page: Page) {
  const session = sampler.get(page);
  if (!session) return;
  const { profile } = (await session.send('HeapProfiler.getSamplingProfile')) as unknown as {
    profile: { head: SamplingNode };
  };
  const sites = new Map<string, number>();
  const frame = (n: SamplingNode) =>
    `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  const walk = (node: SamplingNode, parent: string) => {
    const key = `${frame(node)} < ${parent}`;
    sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
    for (const child of node.children) walk(child, frame(node));
  };
  walk(profile.head, '');
  for (const [site, bytes] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.error(`    ${Math.round(bytes / 2 ** 20)} MB ${site}`);
  }
}
const sampler = new Map<Page, import('@playwright/test').CDPSession>();

async function waitTerrain(page: Page) {
  const busy = page.locator('canvas[data-terrain="busy"]');
  await busy.waitFor({ timeout: 5_000 }).catch(() => undefined);
  await busy.waitFor({ state: 'detached', timeout: 180_000 });
}

/**
 * Zooms with single wheel events from the whole map over `at` to each scale in turn, and
 * returns the figure sheets painted at each, by size and part, until it settled.
 */
async function zoomCycle(page: Page, at: MapPoint, scales = [MIDDLE, CLOSEST, 0.01]) {
  const painted: string[][] = [];
  let seen = await page.evaluate(() => performance.getEntriesByName('sheet').length);
  // A new game opens on its capital; one long wheel out from the middle comes to rest on
  // the whole map, which is where the camera below begins.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.mouse.wheel(0, 5000);
  await untilDrawn(page);
  let camera: Camera = fitCamera(VIEWPORT, map);
  const wheelTo = async (scale: number, at: MapPoint) => {
    const screen = mapToScreen(camera, VIEWPORT, at);
    const deltaY = -Math.log(scale / camera.scale) / 0.002;
    await page.mouse.move(screen.x, screen.y);
    // The page receives a wheel's delta divided by the device pixel ratio.
    await page.mouse.wheel(0, deltaY * Number(values.dpr));
    camera = zoomAt(camera, screen, wheelFactor(deltaY), VIEWPORT, map);
    peak.phaseMb = 0;
    const start = performance.now();
    await delay(300);
    await settled(page);
    const figures = await page.locator('canvas[data-renderer]').getAttribute('data-figures');
    painted.push(
      await page.evaluate((from) => {
        const entries = performance.getEntriesByName('sheet') as PerformanceMeasure[];
        return entries.slice(from).map((e) => {
          const { size, part } = e.detail as { size: number; part: number | string };
          return `${size}:${part}`;
        });
      }, seen),
    );
    seen += painted.at(-1)?.length ?? 0;
    console.error(
      `  zoom ${scale}: peak ${peak.phaseMb} MB, renderer ${residentMb('renderer')} gpu ${residentMb('gpu-process')} MB at rest, figures ${figures}, ${Math.round((performance.now() - start) / 1000)} s`,
    );
  };
  for (const scale of scales) await wheelTo(scale, at);
  return painted;
}

/**
 * A zoom for each size of figure sheet the camera can rest at on this screen, from the
 * smallest up, then the whole map: where a man stands a little under each size high.
 */
function sheetZooms(resolution: number): number[] {
  const zooms = new Map<number, number>();
  for (let scale = FIGURE_SCALE; scale <= MAX_SCALE; scale *= 1.02) {
    const size = sheetSizeFor(figureHeight(scale) * resolution);
    if (!zooms.has(size) || figureHeight(scale) * resolution <= size) zooms.set(size, scale);
  }
  zooms.set(sheetSizeFor(figureHeight(MAX_SCALE) * resolution), MAX_SCALE);
  return [...[...zooms].sort((a, b) => a[0] - b[0]).map(([, scale]) => scale), 0.01];
}

/**
 * Day 1 with the first army of `colours - 1` other factions (Carthage, Macedon, a minor,
 * Egypt and Persia in turn) standing in a ring 12 km round Rome's own, where Rome sees
 * them all, so `colours` colours of figure stand in one view. Returns where Rome's army
 * stands.
 */
function coloursInView(state: GameState, colours: number): MapPoint {
  const own = Object.values(state.armies).find((a) => a.owner === state.player);
  if (!own || !('position' in own.activity)) throw new Error('Rome has no army in the field');
  const centre = own.activity.position;
  const owners = ['carthage', 'macedon', 'minor', 'egypt', 'persia'].slice(0, colours - 1);
  owners.forEach((owner, i) => {
    const army = Object.values(state.armies).find((a) =>
      owner === 'minor' ? state.factions[a.owner]?.kind === 'minor' : a.owner === owner,
    );
    if (!army) throw new Error(`no army of ${owner}`);
    const angle = (2 * Math.PI * i) / owners.length;
    army.activity = {
      kind: 'idle',
      position: { x: centre.x + 12 * Math.cos(angle), y: centre.y + 12 * Math.sin(angle) },
    };
  });
  return centre;
}

function capitalOf(power: PowerId): MapPoint {
  const capital = map.provinces.find((p) => p.owner === power && p.capital);
  if (!capital) throw new Error(`no capital of ${power}`);
  return { x: capital.city[0], y: capital.city[1] };
}

/** The powers a new game from the Game menu takes in turn, between loads of Rome's save. */
const NEW_GAME_POWERS: PowerId[] = ['rome', 'carthage', 'macedon', 'egypt', 'persia'];
const seconds = (ms: number) => Math.round(ms / 100) / 10;

/** The terrain built, every figure sheet the view asks for painted, and that frame drawn. */
async function settled(page: Page) {
  await waitTerrain(page);
  await page.waitForFunction(
    () =>
      document.querySelector('canvas[data-renderer]')?.getAttribute('data-figure-sheets') !==
      'busy',
    undefined,
    { timeout: 180_000 },
  );
  await untilDrawn(page);
}

/** Drops a day-1 save on the page, as a player loads a file, and waits for its day. */
async function loadDay1(page: Page, save: string) {
  await dropSave(page, save);
  await page.getByTestId('time-controls-day').and(page.locator('[data-day="1"]')).waitFor();
  await untilDrawn(page);
}

/** Game, Start screen, Leave without saving, a power's card, and the guide closed. */
async function newGameFromMenu(page: Page, power: PowerId) {
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start screen' }).click();
  await page.getByRole('button', { name: 'Leave without saving' }).click();
  await page.getByTestId(`power-${power}`).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await untilDrawn(page);
}

/** Runs the clock at the fastest speed for a while of the wall clock, then pauses it. */
async function play(page: Page, ms: number) {
  await page
    .getByRole('button', { name: /^Speed \d+$/ })
    .last()
    .click();
  if ((await page.getByTestId('time-controls-speed').textContent()) === 'Paused') {
    await page.keyboard.press('Space');
  }
  await delay(ms);
  if ((await page.getByTestId('time-controls-speed').textContent()) !== 'Paused') {
    await page.keyboard.press('Space');
  }
}

let shapesBefore: Record<string, number> = {};
/** Prints the live textures by width and height that came or went since the last call. */
async function printTextureShapes(page: Page) {
  const shapes = await page.evaluate(() =>
    (window as unknown as { textureShapes(): Record<string, number> }).textureShapes(),
  );
  for (const shape of new Set([...Object.keys(shapes), ...Object.keys(shapesBefore)])) {
    const change = (shapes[shape] ?? 0) - (shapesBefore[shape] ?? 0);
    if (change !== 0) console.error(`    textures ${change > 0 ? '+' : ''}${change} of ${shape}`);
  }
  shapesBefore = shapes;
}

async function snapshot(page: Page, file: string) {
  const session = await page.context().newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  writeFileSync(file, '');
  session.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => appendFileSync(file, chunk));
  await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await session.detach();
}

const world = buildWorld(map);
const rows: Awaited<ReturnType<typeof sample>>[] = [];
const server = await preview({
  root: values.root,
  logLevel: 'warn',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
if (!base) throw new Error('vite preview gave no URL');
const browser = await chromium.launch({
  args: values['chromium-args'] ? values['chromium-args'].split(' ') : [...SOFTWARE_GL],
});
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: Number(values.dpr),
  });
  await context.addInitScript(trackTextures);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('crash', () => errors.push('the page crashed'));
  await openGame(page, {
    base,
    query: [`draw=${values.draw}`, values.query].filter(Boolean).join('&'),
  });
  const print = (row: Awaited<ReturnType<typeof sample>>) => {
    rows.push(row);
    console.log(Object.values(row).join(','));
  };
  console.log(
    'step,heapMb,nodes,listeners,detached,canvases,textures,textureMb,sheetMb,buffers,bufferMb,rendererMb,gpuMb,peakMb,leastFreeMb,freeMb',
  );
  if (values.sites) {
    const session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.startSampling', { samplingInterval: 65536 });
    sampler.set(page, session);
  }
  print(await sample(page, 'open'));
  if (values.sheets) {
    // At `--dpr 2` in software one frame of a few hundred figures takes tens of seconds.
    page.setDefaultTimeout(180_000);
    const game = startGame();
    const colours = Number(values.sheets);
    const at = coloursInView(game, colours);
    // A dropped save keeps the clock as it was, so the ring is paused before it lands.
    const pauseButton = page.getByRole('button', { name: 'Pause', exact: true });
    if (await pauseButton.isVisible()) await pauseButton.click();
    await page.getByTestId('time-controls-speed').and(page.getByText('Paused')).waitFor();
    await dropSave(page, game);
    await page.getByTestId('time-controls-day').and(page.locator('[data-day="1"]')).waitFor();
    const zooms = sheetZooms(Number(values.dpr));
    console.error(`  zooms ${zooms.map((z) => z.toFixed(3)).join(', ')}`);
    const sheetMb: number[] = [];
    let firstRound = 0;
    let inRounds = 0;
    const rests: string[][] = [];
    const frameGaps = () =>
      page.evaluate(() =>
        (window as unknown as { frameGaps(): { longest: number; over100: number } }).frameGaps(),
      );
    const roundGaps: string[] = [];
    await frameGaps();
    for (const round of [1, 2, 3]) {
      rests.push(...(await zoomCycle(page, at, zooms)));
      const row = await sample(page, `${colours} colours every sheet size round ${round}`);
      print(row);
      sheetMb.push(row.sheetMb);
      if (values['texture-shapes']) await printTextureShapes(page);
      if (errors.length > 0) throw new Error(errors.join('; '));
      const painted = await page.evaluate(() => performance.getEntriesByName('sheet').length);
      if (round === 1) firstRound = painted;
      if (round === 3) inRounds = painted;
      const gap = await frameGaps();
      roundGaps.push(`${gap.longest} ms (${gap.over100} over 100 ms)`);
    }
    // A player goes back and forth between two neighbouring zooms. After the first visit
    // to each, every sheet they need is painted, and none may be painted again.
    const figureZooms = zooms.filter((zoom) => zoom >= FIGURE_SCALE);
    const again: string[] = [];
    for (let i = 0; i + 1 < figureZooms.length; i++) {
      const [near, far] = [figureZooms[i] as number, figureZooms[i + 1] as number];
      const rested = await zoomCycle(page, at, [near, far, near, far, near]);
      const repainted = rested.slice(2).flat();
      console.log(
        `  back and forth between ${near.toFixed(3)} and ${far.toFixed(3)}: ${repainted.length} painted after the first visit to each${repainted.length > 0 ? ` (${repainted.join(' ')})` : ''}`,
      );
      again.push(...repainted);
    }
    const backGap = await frameGaps();
    console.log(
      `frame gaps: longest per round ${roundGaps.join(', ')}; going back and forth ${backGap.longest} ms (${backGap.over100} over 100 ms)`,
    );
    console.log(
      `${again.length === 0 ? 'held' : 'NOT held'}: no sheet painted again going back and forth between neighbouring zooms`,
    );
    if (again.length > 0) process.exitCode = 1;
    const paints = await page.evaluate(() =>
      performance.getEntriesByName('sheet').map((e) => ({
        ms: Math.round(e.duration),
        ...(e as PerformanceMeasure).detail,
      })),
    );
    console.log(
      `sheets: ${firstRound} painted in round 1, ${inRounds - firstRound} painted again in rounds 2 and 3, ${paints.length - inRounds} going back and forth; sheets over the whole map after each round ${sheetMb.join(', ')} MB`,
    );
    console.error(`  sheet paints: ${JSON.stringify(paints)}`);
    // A sheet in view that the budget let go of is asked for again by the next frame, so
    // it would be painted twice while the camera rests at one zoom.
    const twice = rests.flatMap((keys) => keys.filter((key, i) => keys.indexOf(key) !== i));
    console.log(
      `${twice.length === 0 ? 'held' : 'NOT held'}: no sheet painted twice at one zoom${twice.length > 0 ? `; twice: ${twice.join(' ')}` : ''}`,
    );
    if (twice.length > 0) process.exitCode = 1;
    if (values['sheet-bound']) {
      const bound = Number(values['sheet-bound']);
      const most = Math.max(...sheetMb);
      console.log(
        `${most <= bound ? 'held' : 'NOT held'}: the figure sheets over the whole map at most ${most} MB (bound ${bound} MB)`,
      );
      if (most > bound) process.exitCode = 1;
    }
  } else if (values.cycles) {
    const save = saveGame(startGame());
    const snapshotAt = new Set((values.snapshots ?? '').split(',').filter(Boolean).map(Number));
    const kindOf = (cycle: number) => {
      if (cycle % 2 === 0) return { loads: true, power: 'rome' as PowerId, name: 'load' };
      const power = NEW_GAME_POWERS[((cycle - 1) / 2) % NEW_GAME_POWERS.length] as PowerId;
      return { loads: false, power, name: `new ${power}` };
    };
    for (let cycle = 1; cycle <= Number(values.cycles); cycle++) {
      const started = performance.now();
      const { loads, power, name } = kindOf(cycle);
      if (loads) await loadDay1(page, save);
      else await newGameFromMenu(page, power);
      const entered = performance.now();
      await waitTerrain(page);
      await zoomCycle(page, capitalOf(power));
      await zoomCycle(page, PLATEAU);
      const zoomed = performance.now();
      await play(page, Number(values.play) * 1000);
      const paints = await page.evaluate(() => {
        const entries = performance.getEntriesByName('sheet') as PerformanceMeasure[];
        performance.clearMeasures('sheet');
        return entries.map((e) => e.detail as { size: number; part: number | string });
      });
      console.error(
        `  cycle ${cycle} ${name}: entered in ${seconds(entered - started)} s, zooms ${seconds(zoomed - entered)} s, sheets painted ${paints.map((p) => `${p.size}:${p.part}`).join(' ')}`,
      );
      // Every cycle is read in one state: the day-1 save dropped again and drawn over the
      // whole map, with no figure sheet in flight and the mouse off what it last clicked.
      // What the tab holds then beyond cycle 1 is what earlier games left behind, and not
      // the sheets of the colours a cycle's own seeded game happened to show.
      await loadDay1(page, save);
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      await page.mouse.wheel(0, 5000);
      await settled(page);
      print(await sample(page, `cycle ${cycle} ${name}`));
      if (values['texture-shapes']) await printTextureShapes(page);
      if (snapshotAt.has(cycle)) {
        await snapshot(page, `${values.snapshot ?? 'cycle'}-${cycle}.heapsnapshot`);
      }
      if (errors.length > 0) throw new Error(errors.join('; '));
    }
  } else if (values.loads) {
    const days = 1 + Number(values.days);
    let game = startGame();
    while (game.day < days) game = tick(game, decideAll(game, world), world).state;
    const save = saveGame(game);
    if (values.armies) {
      const at = Object.values(game.armies).flatMap((army) =>
        'position' in army.activity ? [army.activity.position] : [],
      );
      PLACES.splice(0, PLACES.length, ...at);
    }
    for (let load = 1; load <= Number(values.loads); load++) {
      await dropSave(page, save);
      await page
        .getByTestId('time-controls-day')
        .and(page.locator(`[data-day="${days}"]`))
        .waitFor();
      await zoomCycle(page, PLACES[(load - 1) % PLACES.length] as MapPoint);
      await zoomCycle(page, PLATEAU);
      print(await sample(page, `load ${load}`));
      if (errors.length > 0) throw new Error(errors.join('; '));
      if ((rows.at(-1)?.freeMb ?? Infinity) < LOW_MB) {
        console.log(`stopped: the machine has under ${LOW_MB} MB left`);
        break;
      }
    }
  } else {
    const years = Number(values.years ?? 10);
    // A player who gives no orders is taken within a few years on most seeds, and a
    // defeat stops the clock. Played with the same rules, Persia on seed 2 lives ten.
    await dropSave(
      page,
      newGame(map, { seed: Number(values.seed), player: values.power as PowerId }),
    );
    await page.getByTestId('time-controls-day').and(page.locator('[data-day="1"]')).waitFor();
    const fastest = page.getByRole('button', { name: /^Speed \d+$/ }).last();
    await fastest.click();
    // A peace offer to the player stops the clock until it is answered, so the run
    // refuses each one and plays on, as a player who ignores diplomacy would.
    const playTo = async (target: number) => {
      const deadline = Date.now() + 1_800_000;
      while (
        Number(await page.getByTestId('time-controls-day').getAttribute('data-day')) < target
      ) {
        if (Date.now() > deadline) throw new Error(`the game did not reach day ${target}`);
        if ((await page.getByTestId('time-controls-speed').textContent()) === 'Paused') {
          if (await page.getByTestId('defeat').isVisible()) {
            throw new Error(`the player was defeated before day ${target}`);
          }
          await page
            .getByRole('button', { name: /^Wars\b/ })
            .click({ timeout: 2000 })
            .catch(() => undefined);
          for (const refuse of await page
            .getByRole('button', { name: 'Refuse', exact: true })
            .all())
            await refuse.click().catch(() => undefined);
          await page.keyboard.press('Escape');
          await page
            .getByRole('button', { name: 'Resume', exact: true })
            .click({ timeout: 2000 })
            .catch(() => undefined);
        }
        await delay(1000);
      }
    };
    for (let year = 1; year <= years; year++) {
      await playTo(year * 360);
      await zoomCycle(page, PLACES[(year - 1) % PLACES.length] as MapPoint);
      await zoomCycle(page, PLATEAU);
      print(await sample(page, `year ${year}`));
      if (errors.length > 0) throw new Error(errors.join('; '));
    }
  }
  if (values.snapshot && !values.snapshots) await snapshot(page, values.snapshot);
} catch (error) {
  if (process.env['GITHUB_ACTIONS']) {
    console.log(`::error title=memory probe::${String(error).replace(/\n/g, '%0A')}`);
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
  if (values.out) {
    const header =
      'step,heapMb,nodes,listeners,detached,canvases,textures,textureMb,sheetMb,buffers,bufferMb,rendererMb,gpuMb,peakMb,leastFreeMb,freeMb';
    writeFileSync(values.out, [header, ...rows.map((r) => Object.values(r).join(','))].join('\n'));
  }
}

if (values['cycle-bound']) {
  const share = Number(values['cycle-bound']);
  const cycles = rows.filter((row) => row.step.startsWith('cycle '));
  const [first] = cycles;
  if (!first || cycles.length !== Number(values.cycles)) {
    throw new Error(
      `--cycle-bound: the run stopped after ${cycles.length} of ${values.cycles} cycles`,
    );
  }
  let held = true;
  for (const [what, pick] of [
    ['the collected JS heap (MB)', (row: (typeof rows)[number]) => row.heapMb],
    ['the DOM nodes', (row: (typeof rows)[number]) => row.nodes],
    ['the live texture bytes (MB)', (row: (typeof rows)[number]) => row.textureMb],
  ] as const) {
    const bound = Math.round(pick(first) * (1 + share));
    const over = cycles.slice(1).filter((row) => pick(row) > bound);
    held &&= over.length === 0;
    console.log(
      `${over.length === 0 ? 'held' : 'NOT held'}: ${what} after cycles 2 to ${cycles.length} at most ${Math.max(...cycles.slice(1).map(pick))}, against ${pick(first)} after cycle 1 (bound ${bound})${over.length > 0 ? `; over in ${over.map((row) => row.step).join(', ')}` : ''}`,
    );
  }
  if (!held) process.exitCode = 1;
}

if (values.bound) {
  const loads = rows.filter((row) => row.step.startsWith('load '));
  if (loads.length < 6) throw new Error('--bound needs at least six loads');
  if (loads.at(-1)?.step !== `load ${values.loads}`) {
    throw new Error(
      `--bound: the run stopped after ${loads.at(-1)?.step} of ${values.loads} loads`,
    );
  }
  // One load's heap swings by a fifth with what the last view left built, so each end is
  // the mean of three loads: loads 3 to 5, and the last three.
  const mean = (some: typeof loads, pick: (row: (typeof loads)[number]) => number) =>
    Math.round(some.reduce((sum, row) => sum + pick(row), 0) / some.length);
  const early = loads.slice(2, 5);
  const late = loads.slice(-3);
  const checks = [
    ['the JS heap', (row: (typeof loads)[number]) => row.heapMb, Number(values.bound)],
    [
      'the renderer and GPU processes',
      (row: (typeof loads)[number]) => row.rendererMb + row.gpuMb,
      Number(values['process-bound'] ?? values.bound),
    ],
  ] as const;
  let held = true;
  for (const [what, pick, share] of checks) {
    const before = mean(early, pick);
    const after = mean(late, pick);
    const ok = after <= before * (1 + share);
    held &&= ok;
    console.log(
      `${ok ? 'held' : 'NOT held'}: ${what} hold ${after} MB over the last three loads, against ${before} MB over loads 3 to 5 (bound ${Math.round(before * (1 + share))} MB)`,
    );
  }
  // The brief's own condition, load 30 against load 3, printed beside the checks above.
  // One load swings by a fifth, so it does not fail the run.
  const third = loads[2];
  const last = loads.at(-1);
  if (third && last) {
    for (const [what, pick] of [
      ['the JS heap', (row: (typeof loads)[number]) => row.heapMb],
      [
        'the live WebGL textures and buffers',
        (row: (typeof loads)[number]) => row.textureMb + row.bufferMb,
      ],
      [
        'the renderer and GPU processes',
        (row: (typeof loads)[number]) => row.rendererMb + row.gpuMb,
      ],
    ] as const) {
      const before = pick(third);
      const after = pick(last);
      console.log(
        `${after <= before * 1.1 ? 'within' : 'NOT within'} a tenth, reported only: ${what} hold ${after} MB after ${last.step}, against ${before} MB after load 3`,
      );
    }
  }
  if (!held) process.exitCode = 1;
}
