import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXTURE = resolve(import.meta.dirname, 'runs.fixture.ts');
const WAIT_MS = 2000;

let dir: string;
let env: NodeJS.ProcessEnv;
const pids = new Set<number>();

/** A process's state letter from /proc, or undefined once it has gone. */
function state(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const letter = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    return letter === 'Z' ? undefined : letter;
  } catch {
    return undefined;
  }
}

async function until(what: string, holds: () => boolean): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (!holds()) {
    if (Date.now() > end) throw new Error(`waited ${WAIT_MS} ms for ${what}`);
    await delay(20);
  }
}

interface Started {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function start(args: string[]): Started {
  const child = spawn(process.execPath, [FIXTURE, ...args], { env });
  if (child.pid !== undefined) pids.add(child.pid);
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => (text += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (text += chunk.toString()));
  const exited = new Promise<number | null>((done) => child.on('exit', done));
  return { child, output: () => text, exited };
}

async function heavy(leave = false) {
  const file = join(dir, `pids-${pids.size}.json`);
  const run = start(['heavy', file, ...(leave ? ['leave'] : [])]);
  await until('the heavy command to start its work', () => existsSync(file));
  const { copy, busy } = JSON.parse(readFileSync(file, 'utf8')) as { copy: number; busy: number };
  pids.add(copy);
  pids.add(busy);
  return { ...run, copy, busy };
}

async function testRun() {
  const run = start(['tests']);
  await until('the test run to note itself', () =>
    existsSync(join(dir, `tests-${run.child.pid}.json`)),
  );
  return run;
}

async function end(run: Started) {
  run.child.kill('SIGTERM');
  await run.exited;
}

const paused = (...ids: number[]) => ids.every((pid) => state(pid) === 'T');
const running = (...ids: number[]) => ids.every((pid) => ![undefined, 'T'].includes(state(pid)));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runs-test-'));
  env = { ...process.env, FIRST_GAME_RUNS_DIR: dir, FIRST_GAME_RUNS_WATCH_MS: '50' };
});

/** Every process a fixture of this test started, found by the notes folder they all inherit. */
function fixtureProcesses(): number[] {
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        return `\0${readFileSync(`/proc/${pid}/environ`, 'utf8')}`.includes(
          `\0FIRST_GAME_RUNS_DIR=${dir}\0`,
        );
      } catch {
        return false;
      }
    })
    .map(Number);
}

afterEach(() => {
  for (const pid of new Set([...pids, ...fixtureProcesses()])) {
    for (const signal of ['SIGCONT', 'SIGKILL'] as const) {
      try {
        process.kill(pid, signal);
      } catch {
        // It has ended.
      }
    }
  }
  pids.clear();
  rmSync(dir, { recursive: true, force: true });
});

describe.runIf(existsSync('/proc/self/stat'))('a heavy command beside test runs', () => {
  it('pauses with everything it started while a test run goes, resumes after, and both say so', async () => {
    const work = await heavy();
    expect(running(work.copy, work.busy)).toBe(true);
    const tests = await testRun();
    await until('the heavy work to pause', () => paused(work.copy, work.busy));
    await end(tests);
    await until('the heavy work to resume', () => running(work.copy, work.busy));
    await until('the resume to be told', () => work.output().includes('resumes after'));
    expect(work.output()).toContain('pauses until this test run ends');
    expect(tests.output()).toContain('These heavy commands pause until this test run ends');
    expect(tests.output()).toContain('Heavy commands paused for this test run and resume now');
  });

  it('stays paused until the last of two overlapping test runs ends', async () => {
    const work = await heavy();
    const first = await testRun();
    const second = await testRun();
    await until('the heavy work to pause', () => paused(work.copy, work.busy));
    await end(first);
    await delay(300);
    expect(paused(work.copy, work.busy)).toBe(true);
    await end(second);
    await until('the heavy work to resume', () => running(work.copy, work.busy));
  });

  it('does not pause for a test run that died, nor for a note whose pid another process now holds', async () => {
    const dead = await testRun();
    dead.child.kill('SIGKILL');
    await dead.exited;
    writeFileSync(
      join(dir, 'tests-reused.json'),
      JSON.stringify({
        kind: 'tests',
        what: 'a test run long gone',
        pid: process.pid,
        start: 'another-boot:1',
        started: Date.now(),
      }),
    );
    const work = await heavy();
    await delay(300);
    expect(running(work.copy, work.busy)).toBe(true);
  });

  it('passes a SIGTERM on while paused, and leaves nothing it started running', async () => {
    const work = await heavy();
    await testRun();
    await until('the heavy work to pause', () => paused(work.copy, work.busy));
    work.child.kill('SIGTERM');
    await work.exited;
    await until('the heavy work to end', () => !state(work.copy) && !state(work.busy));
  });

  it('ends what the copy left running when the copy ends, and exits as the copy did', async () => {
    const work = await heavy(true);
    expect(await work.exited).toBe(0);
    await until('the left process to end', () => !state(work.busy));
  });
});
