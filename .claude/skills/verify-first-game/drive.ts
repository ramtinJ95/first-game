#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, expect, type Page } from '@playwright/test';

const USAGE = `node .claude/skills/verify-first-game/drive.ts <command>

Run it from inside the checkout it belongs to; it drives that checkout's build.

  up [--no-build]            build, serve dist/ and start the driver; prints the run
  doctor                     read-only health check of the current run
  open [--power rome|start] [--moment <builder> [--args <json array>] | --save <file>]
       [--viewport 1280x720]
       [--no-pauses] [--query k=v&k=v]
                             open a game as a player would see it
  act '<js>' | act --file f  run async JS with page, expect, support (e2e/support.ts) and
                             evidence (the run's folder) in scope; prints what it returns
  shot <name>                screenshot and ARIA snapshot into the run's evidence folder
  look                       print the page's ARIA snapshot
  play [--until-day N] [--until-text <regex>] [--speed 3] [--seconds 600]
                             play on, resuming after each stop, until the day, a line of
                             news, an ending, or a dialog that asks the player to decide;
                             pauses there and lists every stop with its line
  viewport <W>x<H>           resize the page
  errors                     print the page's console errors and uncaught exceptions
  moment <builder> <file> [--args <json array>]
                             write the save a builder makes: a name in e2e/support.ts, or
                             <path>:<name> such as e2e/trade-game.ts:tradingRome
  down                       stop what this run started; the evidence stays
`;

interface Session {
  runId: string;
  root: string;
  head: string;
  tree: string;
  url: string;
  port: number;
  token: string;
  previewPid: number;
  driverPid: number;
  driverPort: number;
  dir: string;
}

const scriptPath = resolve(import.meta.dirname, 'drive.ts');
const checkout = resolve(import.meta.dirname, '../../..');

function here() {
  const shell = git(process.cwd(), 'rev-parse', '--show-toplevel');
  if (resolve(shell) !== checkout)
    throw new Error(`this shell is in ${shell}; run that checkout's own drive.ts`);
  return checkout;
}

function arg(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function verifyDir(root: string) {
  return join(root, '.cache', 'verify');
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const INPUTS = ['src', 'data', 'index.html', 'package-lock.json'];

function treeOf(root: string) {
  const hash = createHash('sha256').update(git(root, 'diff', 'HEAD', '--binary', '--', ...INPUTS));
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '--', ...INPUTS);
  for (const file of untracked.split('\n').filter(Boolean))
    hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}

function currentSession(root = here()): Session {
  const pointer = join(verifyDir(root), 'current');
  if (!existsSync(pointer)) throw new Error(`no run: start one with "up" (looked in ${pointer})`);
  const runId = readFileSync(pointer, 'utf8').trim();
  return JSON.parse(readFileSync(join(verifyDir(root), runId, 'session.json'), 'utf8')) as Session;
}

function running(pid: number, ...needles: string[]) {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return needles.every((needle) => argv.includes(needle));
  } catch {
    return false;
  }
}

function processes(s: Session) {
  return [
    { name: 'driver', pid: s.driverPid, ours: running(s.driverPid, 'serve', String(s.driverPort)) },
    { name: 'preview', pid: s.previewPid, ours: running(s.previewPid, String(s.port)) },
  ];
}

async function stop(name: string, pid: number, ...needles: string[]) {
  if (!running(pid, ...needles)) return;
  process.kill(-pid, 'SIGTERM');
  await until(`${name} ${pid} to stop`, async () => !running(pid, ...needles), 10).catch(() => {
    if (running(pid, ...needles)) process.kill(-pid, 'SIGKILL');
  });
  console.log(`stopped ${name} ${pid}`);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function until(what: string, check: () => Promise<boolean>, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out after ${seconds}s waiting for ${what}`);
}

function call(session: Session, body: object): Promise<unknown> {
  return new Promise((done, fail) => {
    const req = request(
      { host: '127.0.0.1', port: session.driverPort, method: 'POST', path: '/', timeout: 0 },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => {
          try {
            const reply = JSON.parse(text) as { ok: boolean; value?: unknown; error?: string };
            if (reply.ok) done(reply.value);
            else fail(new Error(reply.error));
          } catch {
            fail(new Error(`the driver on ${session.driverPort} answered ${text || 'nothing'}`));
          }
        });
      },
    );
    req.on('error', fail);
    req.end(JSON.stringify({ ...body, token: session.token }));
  });
}

async function up(args: string[]) {
  const root = here();
  const pointer = join(verifyDir(root), 'current');
  if (existsSync(pointer)) {
    const old = currentSession(root);
    if (processes(old).some((p) => p.ours)) {
      console.log(`run ${old.runId} still has processes at ${old.url}; "down" it first`);
      process.exitCode = 1;
      return;
    }
  }
  if (!args.includes('--no-build')) {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(verifyDir(root), runId);
  mkdirSync(dir, { recursive: true });
  const [port, driverPort] = [await freePort(), await freePort()];
  const url = `http://127.0.0.1:${port}`;
  const token = randomUUID();
  const previewLog = openSync(join(dir, 'preview.log'), 'a');
  const preview = spawn(
    join(root, 'node_modules', '.bin', 'vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, detached: true, stdio: ['ignore', previewLog, previewLog] },
  );
  preview.unref();
  const driverLog = openSync(join(dir, 'driver.log'), 'a');
  const driver = spawn(process.execPath, [scriptPath, 'serve', String(driverPort), url], {
    cwd: root,
    detached: true,
    stdio: ['ignore', driverLog, driverLog],
    env: { ...process.env, VERIFY_TOKEN: token },
  });
  driver.unref();
  const session: Session = {
    runId,
    root,
    head: git(root, 'rev-parse', 'HEAD'),
    tree: treeOf(root),
    url,
    port,
    token,
    previewPid: preview.pid ?? 0,
    driverPid: driver.pid ?? 0,
    driverPort,
    dir,
  };
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 2));
  writeFileSync(pointer, runId);
  try {
    await until('the preview', async () => (await fetch(url)).ok);
    await until('the driver', async () => (await call(session, { op: 'ping' })) !== undefined);
  } catch (error) {
    await down();
    throw error;
  }
  console.log(`run ${runId}\nurl ${url}\nevidence ${dir}`);
}

async function doctor() {
  const s = currentSession();
  const problems: string[] = [];
  const lines: string[] = [`run ${s.runId}`, `evidence ${s.dir}`];
  for (const p of processes(s)) if (!p.ours) problems.push(`${p.name} pid ${p.pid} is gone`);
  const head = git(s.root, 'rev-parse', 'HEAD');
  lines.push(`built ${s.head}`);
  if (head !== s.head) problems.push(`checkout moved to ${head}: "down", then "up" to rebuild`);
  if (treeOf(s.root) !== s.tree)
    problems.push(`${INPUTS.join(', ')} changed since the build: "down", then "up"`);
  try {
    const served = await (await fetch(s.url)).text();
    const built = readFileSync(join(s.root, 'dist', 'index.html'), 'utf8');
    if (served !== built) problems.push(`${s.url} does not serve this checkout's dist/`);
    else lines.push(`serving ${s.url}`);
  } catch (error) {
    problems.push(`${s.url} does not answer: ${String(error)}`);
  }
  if (processes(s)[0]?.ours) {
    try {
      lines.push(`driver ${JSON.stringify(await call(s, { op: 'ping' }))}`);
    } catch (error) {
      problems.push(`driver does not answer: ${String(error)}`);
    }
  }
  console.log([...lines, ...problems.map((p) => `PROBLEM ${p}`)].join('\n'));
  console.log(problems.length === 0 ? 'OK' : 'NOT OK');
  if (problems.length > 0) process.exitCode = 1;
}

async function moment(name: string, file: string, root = here(), json = '[]') {
  const [module, builder] = name.includes(':') ? name.split(':') : ['e2e/support.ts', name];
  const support = (await import(join(root, module ?? ''))) as Record<string, unknown>;
  const { saveGame } = (await import(join(root, 'src', 'sim', 'save.ts'))) as {
    saveGame: (state: unknown) => string;
  };
  const make = support[builder ?? ''];
  if (typeof make !== 'function') {
    const names = Object.keys(support).filter((k) => typeof support[k] === 'function');
    throw new Error(`no builder ${builder} in ${module}; functions: ${names.join(', ')}`);
  }
  const given = JSON.parse(json) as unknown[];
  const made = (make as (...args: unknown[]) => unknown)(...given);
  const saved =
    typeof made === 'string'
      ? made
      : typeof (made as { save?: unknown } | null)?.save === 'string'
        ? (made as { save: string }).save
        : saveGame(made);
  writeFileSync(resolve(file), saved);
  console.log(resolve(file));
}

function textOf(error: unknown) {
  try {
    return String(error);
  } catch {
    return 'an error that cannot be shown as text';
  }
}

function nextShot(dir: string, name: string) {
  const count = readdirSync(dir).filter((f) => f.endsWith('.png')).length + 1;
  return join(dir, `${String(count).padStart(2, '0')}-${name.replace(/[^\w-]/g, '_')}`);
}

async function serve(port: number, url: string) {
  const token = process.env['VERIFY_TOKEN'];
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  process.on('SIGTERM', () => void browser.close().finally(() => process.exit(0)));
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page: Page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (page: Page, ex: typeof expect, support: unknown, evidence: string) => Promise<unknown>;
  const support = (await import(join(process.cwd(), 'e2e', 'support.ts'))) as {
    untilDrawn: (page: Page) => Promise<void>;
  };

  type Command = Record<string, string | undefined> & { op: string };
  const ops: Record<string, (c: Command) => Promise<unknown>> = {
    ping: async () => ({ browser: browser.version(), page: page.url(), size: page.viewportSize() }),
    open: async (c) => {
      const [width, height] = (c['viewport'] ?? '1280x720').split('x').map(Number);
      await page.setViewportSize({ width: width ?? 1280, height: height ?? 720 });
      await page.goto(`${url}/?${c['query']}`);
      await page
        .getByTestId('top-bar')
        .or(page.getByTestId('start-screen'))
        .waitFor({ state: 'visible', timeout: 60_000 });
      if (c['save']) {
        const text = readFileSync(c['save'], 'utf8');
        const pause = page.getByRole('button', { name: 'Pause', exact: true });
        if (await pause.isVisible()) await pause.click();
        const canvas = page.locator('canvas[data-renderer]');
        const given = async () => Number(await canvas.getAttribute('data-latest-state'));
        const before = await given();
        const transfer = await page.evaluateHandle((save) => {
          const t = new DataTransfer();
          t.items.add(new File([save], 'save.json', { type: 'application/json' }));
          return t;
        }, text);
        await page.dispatchEvent('canvas', 'drop', { dataTransfer: transfer });
        const saved = String((JSON.parse(text) as { state: { day: number } }).state.day);
        const day = page.getByTestId('time-controls-day');
        const notice = page.getByTestId('notice');
        const refused = async () =>
          (await notice.isVisible()) && (await notice.getAttribute('data-tone')) !== 'info';
        const loaded = async () =>
          (await day.getAttribute('data-day')) === saved && (await given()) > before;
        await expect.poll(async () => (await refused()) || (await loaded())).toBe(true);
        if (await refused()) throw new Error(`the save was refused: ${await notice.textContent()}`);
        await support.untilDrawn(page);
      }
      const day = page.getByTestId('time-controls-day');
      if (!(await day.isVisible())) return { url: page.url(), screen: 'start' };
      return {
        url: page.url(),
        day: await day.textContent(),
        speed: await page.getByTestId('time-controls-speed').textContent(),
      };
    },
    act: async (c) =>
      new AsyncFunction('page', 'expect', 'support', 'evidence', c['code'] ?? '')(
        page,
        expect,
        support,
        c['dir'] ?? '.',
      ),
    shot: async (c) => {
      const base = nextShot(c['dir'] ?? '.', c['name'] ?? 'shot');
      await page.screenshot({ path: `${base}.png` });
      writeFileSync(`${base}.aria.yml`, await page.locator('body').ariaSnapshot());
      return `${base}.png`;
    },
    look: async () => page.locator('body').ariaSnapshot(),
    play: async (c) => {
      const dayOf = async () =>
        Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
      const resume = page.getByRole('button', { name: 'Resume', exact: true });
      const untilDay = Number(c['untilDay'] ?? Infinity);
      const pattern = c['untilText'] ? new RegExp(c['untilText']) : null;
      const end = Date.now() + Number(c['seconds'] ?? 600) * 1000;
      const stops: { day: number; line: string }[] = [];
      let decision: { testid: string | null; name: string } | undefined;
      let stalled: string | undefined;
      await page.getByRole('button', { name: `Speed ${c['speed'] ?? '3'}` }).click();
      for (;;) {
        const alerts = page.getByTestId('alerts');
        const paused = await resume.isVisible();
        if (paused) {
          const marked = alerts
            .getByRole('listitem')
            .filter({ has: page.getByTestId('alert-paused') });
          const line = (
            (await marked
              .first()
              .textContent({ timeout: 1000 })
              .catch(() => '')) ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          if (line && stops.at(-1)?.line !== line) stops.push({ day: await dayOf(), line });
        }
        if (await page.getByTestId('defeat').or(page.getByTestId('victory')).isVisible()) break;
        const open = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({
          visible: true,
        });
        if ((await open.count()) > 0) {
          const dialog = open.first();
          decision = {
            testid: await dialog.getAttribute('data-testid'),
            name: (await dialog.getByRole('heading').first().textContent({ timeout: 1000 })) ?? '',
          };
          break;
        }
        if (pattern && (await alerts.getByText(pattern).count()) > 0) break;
        const today = await dayOf();
        if (today >= untilDay) break;
        const slow = page.getByRole('button', { name: 'Speed 1' });
        if (untilDay - today <= 5 && (await slow.getAttribute('aria-pressed')) !== 'true')
          // A dialog that opens meanwhile blocks the click; the next pass reports it.
          await slow.click({ timeout: 1000 }).catch(() => undefined);
        if (Date.now() > end) {
          stalled = `still on day ${await dayOf()} after the time given`;
          break;
        }
        if (paused) await resume.click();
        await page.waitForTimeout(200);
      }
      const pause = page.getByRole('button', { name: 'Pause', exact: true });
      if (await pause.isVisible()) await pause.click();
      return {
        day: await dayOf(),
        stops,
        ...(decision && { decision }),
        ...(stalled && { stalled }),
      };
    },
    viewport: async (c) => {
      const [width, height] = (c['size'] ?? '').split('x').map(Number);
      await page.setViewportSize({ width: width ?? 1280, height: height ?? 720 });
      return page.viewportSize();
    },
    errors: async () => errors,
  };

  createServer((req: IncomingMessage, res: ServerResponse) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString()));
    req.on('end', () => {
      const reply = (body: object) => {
        try {
          res.end(JSON.stringify(body));
        } catch (error) {
          res.end(JSON.stringify({ ok: false, error: `not sendable as JSON: ${textOf(error)}` }));
        }
      };
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return reply({ ok: false, error: 'not a JSON command' });
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return reply({ ok: false, error: 'not a JSON command' });
      const command = parsed as Command;
      if (req.method !== 'POST' || !token || command['token'] !== token)
        return reply({ ok: false, error: "not this run's driver" });
      const name: unknown = command.op;
      if (typeof name !== 'string') return reply({ ok: false, error: 'op is not a string' });
      const op = Object.hasOwn(ops, name) ? ops[name] : undefined;
      if (typeof op !== 'function') return reply({ ok: false, error: `unknown op ${name}` });
      Promise.resolve()
        .then(() => op(command))
        .then(
          (value) => reply({ ok: true, value: value ?? null }),
          (error: unknown) => reply({ ok: false, error: textOf(error) }),
        );
    });
  }).listen(port, '127.0.0.1');
  console.log(`driver on ${port} for ${url}`);
}

async function down() {
  const s = currentSession();
  await stop('driver', s.driverPid, 'serve', String(s.driverPort));
  await stop('preview', s.previewPid, String(s.port));
  console.log(`evidence kept in ${s.dir}`);
}

function print(value: unknown) {
  if (value === null || value === undefined) return;
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'up':
    await up(args);
    break;
  case 'doctor':
    await doctor();
    break;
  case 'serve':
    await serve(Number(args[0]), args[1] ?? '');
    break;
  case 'moment':
    await moment(args[0] ?? '', args[1] ?? 'save.json', here(), arg(args, '--args'));
    break;
  case 'down':
    await down();
    break;
  case 'open': {
    const s = currentSession();
    const query = new URLSearchParams(arg(args, '--query') ?? '');
    const power = arg(args, '--power') ?? 'rome';
    if (power !== 'start') query.set('play', power);
    if (args.includes('--no-pauses')) query.set('pauses', 'off');
    let save = arg(args, '--save');
    const builder = arg(args, '--moment');
    if (builder) {
      save = join(s.dir, `${builder.replace(/\W/g, '_')}.save.json`);
      await moment(builder, save, s.root, arg(args, '--args'));
    }
    print(
      await call(s, {
        op: 'open',
        query: query.toString(),
        viewport: arg(args, '--viewport'),
        save: save && resolve(save),
      }),
    );
    break;
  }
  case 'act': {
    const file = arg(args, '--file');
    const code = file ? readFileSync(file, 'utf8') : args.join(' ');
    const s = currentSession();
    print(await call(s, { op: 'act', code, dir: s.dir }));
    break;
  }
  case 'shot': {
    const s = currentSession();
    print(await call(s, { op: 'shot', name: args[0], dir: s.dir }));
    break;
  }
  case 'look':
  case 'errors':
    print(await call(currentSession(), { op: command }));
    break;
  case 'play': {
    const played = await call(currentSession(), {
      op: 'play',
      untilDay: arg(args, '--until-day'),
      untilText: arg(args, '--until-text'),
      speed: arg(args, '--speed'),
      seconds: arg(args, '--seconds'),
    });
    print(played);
    if (typeof played === 'object' && played !== null && 'stalled' in played) process.exitCode = 1;
    break;
  }
  case 'viewport':
    print(await call(currentSession(), { op: 'viewport', size: args[0] }));
    break;
  default:
    console.log(USAGE);
    if (command !== 'help') process.exitCode = 2;
}
