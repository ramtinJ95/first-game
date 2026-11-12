import { chromium, type Browser } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { preview } from 'vite';
import { encodeGif, type GifFrame } from './gif.ts';
import {
  declareNexusOutputs,
  isImage,
  MANIFEST_FILE,
  type ManifestEntry,
  type NexusOutput,
} from './manifest.ts';
import { SOFTWARE_GL } from '../../playwright.config.ts';
import type { Scenario } from './scenario.ts';

const CAPTURES_DIR = resolve('captures');
const SCENARIOS_DIR = join(import.meta.dirname, 'scenarios');
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const FRAME_INTERVAL_MS = 125;
const CLIP_LIMIT_MS = 12_000;
const GIF_WIDTHS = [800, 640, 480] as const;
const GIF_MAX_BYTES = 5 * 1024 * 1024;

interface ScenarioResult {
  failures: string[];
  outputs: NexusOutput[];
}

async function loadScenarios(names: string[]): Promise<Scenario[]> {
  const files = readdirSync(SCENARIOS_DIR)
    .filter((file) => file.endsWith('.ts'))
    .sort();
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const module = (await import(pathToFileURL(join(SCENARIOS_DIR, file)).href)) as {
      default?: Scenario;
    };
    const scenario = module.default;
    const name = basename(file, '.ts');
    if (typeof scenario?.run !== 'function' || scenario.name !== name) {
      throw new Error(`${file} must default-export defineScenario({ name: '${name}', ... })`);
    }
    scenarios.push(scenario);
  }
  const unknown = names.filter((name) => !scenarios.some((scenario) => scenario.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `unknown scenario ${unknown.join(', ')}; available: ${scenarios.map((s) => s.name).join(', ')}`,
    );
  }
  return names.length === 0 ? scenarios : scenarios.filter((s) => names.includes(s.name));
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function encodeClip(frames: GifFrame[]): Buffer {
  const [widest, ...narrower] = GIF_WIDTHS;
  let gif = encodeGif(frames, widest);
  for (const width of narrower) {
    if (gif.length < GIF_MAX_BYTES) break;
    gif = encodeGif(frames, width);
  }
  return gif;
}

async function captureScenario(
  browser: Browser,
  baseURL: string,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const dir = join(CAPTURES_DIR, scenario.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const videoDir = mkdtempSync(join(tmpdir(), 'capture-video-'));
  const viewport = scenario.viewport ?? DEFAULT_VIEWPORT;
  const context = await browser.newContext({
    baseURL,
    viewport,
    recordVideo: { dir: videoDir, size: viewport },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();

  const failures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));

  const entries: ManifestEntry[] = [];
  const shot = async (name: string, title: string) => {
    const file = `${name}.png`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || entries.some((entry) => entry.file === file)) {
      throw new Error(`shot name "${name}" must be unique kebab-case`);
    }
    await page.screenshot({ path: join(dir, file) });
    entries.push({ file, title, kind: 'screenshot' });
  };

  let finished = false;
  const ran = Promise.withResolvers<undefined>();
  const frames: { png: Buffer; atMs: number }[] = [];
  const firstLoad = page.waitForEvent('load', { timeout: 0 }).catch(() => undefined);
  const recording = (async () => {
    await Promise.race([firstLoad, ran.promise]);
    const start = performance.now();
    while (!finished && performance.now() - start < CLIP_LIMIT_MS) {
      const atMs = performance.now() - start;
      frames.push({ png: await page.screenshot(), atMs });
      await delay(Math.max(0, FRAME_INTERVAL_MS - (performance.now() - start - atMs)));
    }
  })().catch((error: unknown) => {
    failures.push(`clip recording failed: ${String(error)}`);
  });

  try {
    await scenario.run({ page, shot });
  } catch (error) {
    failures.push(
      `scenario threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  } finally {
    finished = true;
    ran.resolve(undefined);
    await recording;
  }

  await context.tracing.stop({ path: join(dir, 'trace.zip') });
  const video = page.video();
  await context.close();
  await video?.saveAs(join(dir, 'video.webm'));
  rmSync(videoDir, { recursive: true, force: true });

  if (frames.length > 0) {
    const timed = frames.map((frame, i) => ({
      png: frame.png,
      delayMs: (frames[i + 1]?.atMs ?? frame.atMs + FRAME_INTERVAL_MS) - frame.atMs,
    }));
    writeFileSync(join(dir, 'clip.gif'), encodeClip(timed));
    entries.push({ file: 'clip.gif', title: scenario.title, kind: 'clip' });
  }
  if (video)
    entries.push({ file: 'video.webm', title: `${scenario.title} (video)`, kind: 'video' });
  entries.push({ file: 'trace.zip', title: `${scenario.title} (Playwright trace)`, kind: 'trace' });
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(entries, null, 2) + '\n');

  const outputs = entries
    .filter((entry) => isImage(entry) || entry.kind === 'video')
    .map((entry) => ({ path: join(dir, entry.file), title: entry.title }));
  return { failures, outputs };
}

async function main(names: string[]): Promise<number> {
  const scenarios = await loadScenarios(names);
  if (names.length === 0) rmSync(CAPTURES_DIR, { recursive: true, force: true });

  const port = await freePort();
  const server = await preview({
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  const results: ScenarioResult[] = [];
  try {
    const browser = await chromium.launch({ args: [...SOFTWARE_GL] });
    try {
      for (const scenario of scenarios) {
        console.log(`capturing ${scenario.name}`);
        const result = await captureScenario(browser, `http://127.0.0.1:${port}`, scenario);
        for (const failure of result.failures) {
          console.error(`::error::${scenario.name}: ${failure.replaceAll('\n', ' | ')}`);
        }
        results.push(result);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }

  if (results.some((result) => result.failures.length > 0)) return 1;
  console.log(`captures written to ${CAPTURES_DIR}`);
  declareNexusOutputs(results.flatMap((result) => result.outputs));
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  return 1;
});
