import { chromium, type Page } from '@playwright/test';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
import { dropSave, map, openGame, startGame } from './support.ts';

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
 *   node e2e/memory-bench.ts [--loads 30 | --years 10] [--days 300] [--draw full] [--out file.csv]
 */
const { values } = parseArgs({
  options: {
    loads: { type: 'string' },
    bound: { type: 'string' },
    'process-bound': { type: 'string' },
    years: { type: 'string' },
    days: { type: 'string', default: '300' },
    draw: { type: 'string', default: 'full' },
    root: { type: 'string' },
    out: { type: 'string' },
    snapshot: { type: 'string' },
    query: { type: 'string', default: '' },
    armies: { type: 'boolean', default: false },
    sites: { type: 'boolean', default: false },
  },
});

/** A run stops once the machine has less than this left, before the tab or the run is killed. */
const LOW_MB = 300;
const VIEWPORT = { width: 1280, height: 720 };
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
  proto.createTexture = function (this: WebGL2RenderingContext) {
    const texture = create.call(this);
    if (texture) sizes.set(texture, 0);
    return texture;
  };
  proto.deleteTexture = function (this: WebGL2RenderingContext, texture: WebGLTexture | null) {
    if (texture) sizes.delete(texture);
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
    }
    return image.apply(this, args);
  } as typeof proto.texImage2D;
  proto.texStorage2D = function (this: WebGL2RenderingContext, target, levels, format, w, h) {
    const texture = bound.get(this);
    if (texture) sizes.set(texture, w * h * 4);
    return storage.call(this, target, levels, format, w, h);
  };
  Object.assign(window, {
    textureReport: () => ({
      count: sizes.size,
      bytes: [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0),
      buffers: buffers.size,
      bufferBytes: [...buffers.values()].reduce((sum, bytes) => sum + bytes, 0),
    }),
  });
}

/** Resident set of every Chromium process of a type, in MB, read from /proc. */
function residentMb(type: string): number {
  let kb = 0;
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
        textureReport(): { count: number; bytes: number; buffers: number; bufferBytes: number };
      }
    ).textureReport(),
  );
  if (values.sites) await printSites(page);
  await session.detach();
  return {
    step,
    heapMb: Math.round(metric('JSHeapUsedSize') / 2 ** 20),
    nodes: metric('Nodes'),
    listeners: metric('JSEventListeners'),
    textures: textures.count,
    textureMb: Math.round(textures.bytes / 2 ** 20),
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
  Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0) >> 10;

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

/** Zooms with single wheel events from the whole map to the plateau, closer and closer, then out. */
async function zoomCycle(page: Page, at: MapPoint) {
  let camera: Camera = fitCamera(VIEWPORT, map);
  const wheelTo = async (scale: number, at: MapPoint) => {
    const screen = mapToScreen(camera, VIEWPORT, at);
    const deltaY = -Math.log(scale / camera.scale) / 0.002;
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.wheel(0, deltaY);
    camera = zoomAt(camera, screen, wheelFactor(deltaY), VIEWPORT, map);
    peak.phaseMb = 0;
    const start = performance.now();
    await delay(300);
    await waitTerrain(page);
    const figures = await page.locator('canvas[data-renderer]').getAttribute('data-figures');
    console.error(
      `  zoom ${scale}: peak ${peak.phaseMb} MB, renderer ${residentMb('renderer')} gpu ${residentMb('gpu-process')} MB at rest, figures ${figures}, ${Math.round((performance.now() - start) / 1000)} s`,
    );
  };
  await wheelTo(MIDDLE, at);
  await wheelTo(CLOSEST, at);
  await wheelTo(0.01, at);
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
const browser = await chromium.launch({ args: [...SOFTWARE_GL] });
try {
  const context = await browser.newContext({ viewport: VIEWPORT });
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
    'step,heapMb,nodes,listeners,textures,textureMb,buffers,bufferMb,rendererMb,gpuMb,peakMb,leastFreeMb,freeMb',
  );
  if (values.sites) {
    const session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.startSampling', { samplingInterval: 65536 });
    sampler.set(page, session);
  }
  print(await sample(page, 'open'));
  if (values.loads) {
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
  if (values.snapshot) {
    const session = await page.context().newCDPSession(page);
    writeFileSync(values.snapshot, '');
    const file = values.snapshot;
    session.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => appendFileSync(file, chunk));
    await session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  }
} finally {
  await browser.close();
  await server.close();
  if (values.out) {
    const header =
      'step,heapMb,nodes,listeners,textures,textureMb,buffers,bufferMb,rendererMb,gpuMb,peakMb,leastFreeMb,freeMb';
    writeFileSync(values.out, [header, ...rows.map((r) => Object.values(r).join(','))].join('\n'));
  }
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
  if (!held) process.exitCode = 1;
}
