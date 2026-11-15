import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** The title of the annotation in which a capture shard reports its seconds by scenario. */
export const TIMES_TITLE = 'capture seconds';
export const SECONDS_FILE = join(import.meta.dirname, 'scenario-seconds.json');

export interface ShardTimes {
  readonly shard: string;
  readonly seconds: Readonly<Record<string, number>>;
}

/**
 * The workflow command that reports a shard's seconds as an annotation. The API serves
 * annotations to readers who cannot fetch a job's log, so `capture:timings` can read them.
 */
export function timesAnnotation(times: ShardTimes): string {
  return `::notice title=${TIMES_TITLE}::${JSON.stringify(times)}`;
}

/** The shard times an annotation reports, or nothing for any other annotation. */
export function parseTimes(title: string, message: string): ShardTimes | undefined {
  if (title !== TIMES_TITLE) return undefined;
  const parsed: unknown = JSON.parse(message);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('shard' in parsed) ||
    !('seconds' in parsed) ||
    typeof parsed.shard !== 'string' ||
    typeof parsed.seconds !== 'object' ||
    parsed.seconds === null
  ) {
    throw new Error(`malformed ${TIMES_TITLE} annotation: ${message}`);
  }
  const seconds: Record<string, number> = {};
  for (const [name, value] of Object.entries(parsed.seconds)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`malformed ${TIMES_TITLE} for ${name}: ${String(value)}`);
    }
    seconds[name] = value;
  }
  return { shard: parsed.shard, seconds };
}

/** The recorded seconds with the measured ones in their place, sorted by name. */
export function mergeTimes(
  recorded: Readonly<Record<string, number>>,
  measured: readonly ShardTimes[],
  scenarios: readonly string[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const name of [...scenarios].sort()) {
    const value = measured.find((times) => name in times.seconds)?.seconds[name] ?? recorded[name];
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

function ghApi(path: string): unknown {
  return JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8' }),
  );
}

/** The shard times every capture shard of the run reported. */
function runTimes(repo: string, run: string): ShardTimes[] {
  const pages = ghApi(`repos/${repo}/actions/runs/${run}/jobs?per_page=100`) as {
    jobs: { id: number; name: string }[];
  }[];
  const jobs = pages
    .flatMap((page) => page.jobs)
    .filter((job) => job.name.startsWith('capture-shards'));
  return jobs.flatMap((job) => {
    const notes = (
      ghApi(`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`) as {
        title: string;
        message: string;
      }[][]
    ).flat();
    return notes.flatMap((note) => parseTimes(note.title, note.message) ?? []);
  });
}

function main() {
  const { values } = parseArgs({
    options: { run: { type: 'string' }, repo: { type: 'string', default: 'ramtinJ95/first-game' } },
  });
  if (!values.run)
    throw new Error('usage: npm run capture:timings -- --run <run id> [--repo owner/name]');
  const measured = runTimes(values.repo, values.run);
  if (measured.length === 0) throw new Error(`run ${values.run} reported no ${TIMES_TITLE}`);
  const scenarios = readdirSync(join(import.meta.dirname, 'scenarios'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.replace(/\.ts$/, ''));
  const recorded = JSON.parse(readFileSync(SECONDS_FILE, 'utf8')) as Record<string, number>;
  const merged = mergeTimes(recorded, measured, scenarios);
  writeFileSync(SECONDS_FILE, `${JSON.stringify(merged, null, 2)}\n`);
  for (const times of [...measured].sort((a, b) => a.shard.localeCompare(b.shard))) {
    const total = Object.values(times.seconds).reduce((sum, value) => sum + value, 0);
    console.log(`shard ${times.shard}: ${total.toFixed(0)}s`);
  }
  const missing = scenarios.filter((name) => !measured.some((times) => name in times.seconds));
  if (missing.length > 0) console.log(`not measured in run ${values.run}: ${missing.join(', ')}`);
  console.log(`wrote ${Object.keys(merged).length} scenarios to ${SECONDS_FILE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
