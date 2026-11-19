import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { setPriority, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Test runs and heavy commands leave a note here while they go, so each can say what ran
 * beside it. The folder is the machine's, not the checkout's, as the cores are.
 * `FIRST_GAME_RUNS_DIR` moves it, so a test of this module keeps apart from real runs.
 */
const DIR = process.env['FIRST_GAME_RUNS_DIR'] ?? join(tmpdir(), 'first-game-runs');
/** The lowest CPU priority: beside a process at the normal priority it gets about 1.4 % of a core. */
const LOWEST_PRIORITY = 19;
const DAY_MS = 24 * 60 * 60 * 1000;

type Kind = 'tests' | 'heavy';

interface Note {
  kind: Kind;
  what: string;
  pid: number;
  /** The process's start, so a pid the system gives to another process is not taken for it. */
  start?: string;
  started: number;
  ended?: number;
}

function readOr(path: string, fallback: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return fallback;
  }
}

const BOOT = readOr('/proc/sys/kernel/random/boot_id', '');

/** The boot and the clock tick a process started at, or undefined where /proc cannot say. */
function startOf(pid: number): string | undefined {
  const stat = readOr(`/proc/${pid}/stat`, '');
  if (stat === '') return undefined;
  return `${BOOT}:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`;
}

function alive(pid: number, start?: string): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return start === undefined || startOf(pid) === start;
}

/**
 * Writes the file whole under another name and renames it into place, so a reader in another
 * process finds the old note, the new one, or none, and never half of one.
 */
export function writeWhole(path: string, text: string): void {
  const part = `${path}.${process.pid}.part`;
  writeFileSync(part, text);
  renameSync(part, path);
}

function notes(): Note[] {
  let names: string[];
  try {
    names = readdirSync(DIR);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(DIR, name);
    if (!name.endsWith('.json')) {
      // A writer that died between writing and renaming left its part behind.
      try {
        if (Date.now() - statSync(path).mtimeMs > DAY_MS) rmSync(path, { force: true });
      } catch {
        // Another reader removed it first.
      }
      return [];
    }
    try {
      const note = JSON.parse(readFileSync(path, 'utf8')) as Note;
      const over = note.ended ?? (alive(note.pid, note.start) ? undefined : note.started);
      if (over !== undefined && Date.now() - over > DAY_MS) {
        rmSync(path, { force: true });
        return [];
      }
      return [over === undefined || note.ended !== undefined ? note : { ...note, ended: over }];
    } catch {
      return [];
    }
  });
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

function label(note: Note): string {
  const until = note.ended === undefined ? 'still going' : `until ${clock(note.ended)}`;
  return `${note.what} (pid ${note.pid}, from ${clock(note.started)} ${until})`;
}

/**
 * Notes this process as a run of `kind` and returns what to call when it ends, which gives
 * the runs of the other kind that went beside it.
 */
function startRun(kind: Kind, what: string): { others: () => Note[]; end: () => Note[] } {
  const note: Note = {
    kind,
    what,
    pid: process.pid,
    start: startOf(process.pid),
    started: Date.now(),
  };
  const path = join(DIR, `${kind}-${process.pid}.json`);
  mkdirSync(DIR, { recursive: true });
  writeWhole(path, JSON.stringify(note));
  const others = () =>
    notes().filter(
      (other) =>
        other.kind !== kind &&
        other.started <= Date.now() &&
        (other.ended === undefined || other.ended >= note.started),
    );
  return {
    others,
    end: () => {
      writeWhole(path, JSON.stringify({ ...note, ended: Date.now() }));
      return others();
    },
  };
}

/** What started this heavy command, as the person typed it. */
function command(): string {
  const event = process.env['npm_lifecycle_event'];
  const script = relative(process.cwd(), process.argv[1] ?? '');
  const start = event && event !== 'npx' ? `npm run ${event}` : `node ${script}`;
  return [start, ...process.argv.slice(2)].join(' ');
}

/** Set in the copy of a heavy command that runs in its own session. */
const COPY = 'FIRST_GAME_HEAVY_COPY';
const MARK = 'FIRST_GAME_HEAVY_RUN';
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
/** How often a heavy command looks for a test run to pause for. */
const WATCH_MS = Number(process.env['FIRST_GAME_RUNS_WATCH_MS'] ?? 1000);
/** How long what the copy left running has to end after a SIGTERM before it is killed. */
const LEFTOVER_GRACE_MS = 5000;

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

/**
 * `roots`, every process whose environment holds `mark`, and every process they started,
 * parents before children. Chromium and ffmpeg take sessions of their own, so a signal to
 * the copy's process group would miss them, and a process the copy started and left goes to
 * init, out of its tree, but keeps the mark it was started with.
 */
function processTree(roots: number[], mark: string): number[] {
  const children = new Map<number, number[]>();
  const marked: number[] = [];
  for (const name of readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))) {
    const stat = readOr(`/proc/${name}/stat`, '');
    if (stat === '') continue;
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    children.set(parent, [...(children.get(parent) ?? []), Number(name)]);
    if (`\0${readOr(`/proc/${name}/environ`, '')}`.includes(`\0${mark}\0`))
      marked.push(Number(name));
  }
  const tree = [...new Set([...roots, ...marked])];
  const seen = new Set(tree);
  for (let i = 0; i < tree.length; i++) {
    for (const child of children.get(tree[i] as number) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        tree.push(child);
      }
    }
  }
  return tree;
}

/**
 * For a heavy command, first thing: runs the command again as a copy in a session of its own
 * at the lowest CPU priority, and pauses that copy, with every process it started, while a
 * test run goes on the machine, so the test run has the cores, keeps its time limits, and
 * never meets the heavy work. The kernel shares the cores between sessions before it weighs
 * the processes in each, and a session can lower its priority but never raise it again, so
 * the copy takes a new session and lowers that. Measured on a 2-core pylon, a test run
 * beside a copy at the lowest priority still went 1.3 times slower, as the two share the
 * machine below the scheduler, so the copy pauses. Resolves in the copy; the process that
 * was started watches, says when it pauses and resumes, passes on Ctrl-C and the like, and
 * exits as the copy does.
 */
export async function yieldToTests(): Promise<void> {
  if (!existsSync('/proc/self/stat')) {
    setPriority(LOWEST_PRIORITY);
    console.error(
      `${command()} runs at the lowest CPU priority. It cannot pause for test runs here, as this system has no /proc to find its processes in.`,
    );
    return;
  }
  if (process.env[COPY] !== undefined) {
    try {
      writeFileSync('/proc/self/autogroup', String(LOWEST_PRIORITY));
    } catch {
      // Without the kernel's session groups, the process's own priority is all there is.
    }
    setPriority(LOWEST_PRIORITY);
    return;
  }
  const what = command();
  const run = startRun('heavy', what);
  console.error(
    `${what} pauses while a test run goes on this machine, and otherwise runs at the lowest CPU priority, so a test run gets the cores first.`,
  );
  // Names this run's processes, as their environment passes on to all they start.
  const mark = `${process.pid}:${startOf(process.pid) ?? Date.now()}`;
  const copy = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, [COPY]: what, [MARK]: mark },
  });
  // Every process the copy has started, as the copy's own children outlive it under init.
  const known = new Map<number, string | undefined>();
  const copyStart = copy.pid === undefined ? undefined : startOf(copy.pid);
  const living = () => {
    for (const [pid, start] of known) if (!alive(pid, start)) known.delete(pid);
    const roots = [...known.keys()];
    if (copy.pid !== undefined && alive(copy.pid, copyStart)) roots.push(copy.pid);
    for (const pid of processTree(roots, `${MARK}=${mark}`)) {
      if (!known.has(pid)) known.set(pid, startOf(pid));
    }
    return [...known.keys()];
  };
  const signalAll = (signal: NodeJS.Signals) => {
    const pids = living();
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch {
        // The process has ended.
      }
    }
    return pids;
  };
  /** Stops the tree until a scan after the stop finds just what it stopped, as one may fork meanwhile. */
  const stopAll = () => {
    for (;;) {
      const stopped = new Set(signalAll('SIGSTOP'));
      const now = living();
      if (now.length === stopped.size && now.every((pid) => stopped.has(pid))) return;
    }
  };
  for (const signal of FORWARDED) {
    process.on(signal, () => {
      signalAll(signal);
      signalAll('SIGCONT');
    });
  }
  let pausedAt: number | undefined;
  let paused = 0;
  const watch = setInterval(() => {
    const tests = run.others().filter((note) => note.ended === undefined);
    if (tests.length > 0) {
      stopAll();
      if (pausedAt === undefined) {
        pausedAt = Date.now();
        console.error(`${what} pauses until this test run ends: ${tests.map(label).join('; ')}.`);
      }
    } else if (pausedAt !== undefined) {
      signalAll('SIGCONT');
      paused += Date.now() - pausedAt;
      console.error(
        `${what} resumes after ${seconds(Date.now() - pausedAt)} paused for a test run.`,
      );
      pausedAt = undefined;
    } else living();
  }, WATCH_MS);
  const code = await new Promise<number>((done) =>
    copy.on('exit', (status, signal) => done(status ?? (signal ? 1 : 0))),
  );
  clearInterval(watch);
  if (living().length > 0) {
    signalAll('SIGCONT');
    signalAll('SIGTERM');
    const until = Date.now() + LEFTOVER_GRACE_MS;
    while (living().length > 0 && Date.now() < until) await delay(100);
    signalAll('SIGKILL');
  }
  run.end();
  if (paused > 0)
    console.error(
      `${what} was paused ${seconds(paused)} in all for test runs. Its own time limits went on counting while it was paused, so a timeout in it may come from a pause; run it again.`,
    );
  process.exit(code);
}

/** For a test run: notes it, says which heavy commands pause for it, and returns the teardown. */
export function noteTestRun(): () => void {
  const run = startRun('tests', ['vitest', ...process.argv.slice(2)].join(' '));
  const heavy = run.others().filter((note) => note.ended === undefined);
  if (heavy.length > 0)
    console.log(
      `These heavy commands pause until this test run ends: ${heavy.map(label).join('; ')}.`,
    );
  return () => {
    const met = run.end();
    if (met.length > 0)
      console.log(
        `Heavy commands paused for this test run and resume now: ${met.map(label).join('; ')}.`,
      );
  };
}
