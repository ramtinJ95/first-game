import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as v from 'valibot';
import type { ReferenceInfo } from './selection.ts';

const Runs = v.object({
  workflow_runs: v.array(
    v.object({ id: v.number(), head_sha: v.string(), html_url: v.string(), status: v.string() }),
  ),
});
const Artifacts = v.object({
  artifacts: v.array(v.object({ name: v.string(), expired: v.boolean() })),
});

export type WorkflowRun = v.InferOutput<typeof Runs>['workflow_runs'][number];
export type Artifact = v.InferOutput<typeof Artifacts>['artifacts'][number];

// GitHub lists `runs` newest first.
export function chooseReferenceRun(
  runs: WorkflowRun[],
  base: string,
  artifactsOf: (run: WorkflowRun) => Artifact[],
): { run: WorkflowRun; exact: boolean } | null {
  const completed = runs.filter((run) => run.status === 'completed');
  const candidates = [
    ...completed.filter((run) => run.head_sha === base),
    ...completed.filter((run) => run.head_sha !== base),
  ];
  const run = candidates.find((candidate) => {
    const captures = artifactsOf(candidate).filter(({ name }) => /^captures-\d+$/.test(name));
    return captures.length > 0 && captures.every(({ expired }) => !expired);
  });
  return run ? { run, exact: run.head_sha === base } : null;
}

function ghApi(path: string): unknown {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
}

function downloadScreenshots(repo: string, run: WorkflowRun, out: string): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const staging = mkdtempSync(`${out}-download-`);
  try {
    execFileSync(
      'gh',
      ['run', 'download', String(run.id), '-R', repo, '-p', 'captures-*', '-D', staging],
      { stdio: 'inherit' },
    );
    for (const artifact of readdirSync(staging)) {
      for (const scenario of readdirSync(join(staging, artifact))) {
        renameSync(join(staging, artifact, scenario), join(out, scenario));
      }
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      base: { type: 'string' },
      'base-ref': { type: 'string', default: 'main' },
      out: { type: 'string', default: 'reference' },
      info: { type: 'string', default: 'reference.json' },
    },
  });
  const { repo, base } = values;
  const baseRef = values['base-ref'];
  if (!repo || !base) throw new Error('usage: reference.ts --repo <owner/name> --base <sha>');
  const runs = v.parse(
    Runs,
    ghApi(
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(baseRef)}&per_page=30`,
    ),
  ).workflow_runs;
  const chosen = chooseReferenceRun(
    runs,
    base,
    (run) =>
      v.parse(Artifacts, ghApi(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`))
        .artifacts,
  );
  if (!chosen) {
    console.error(
      `no ${baseRef} run has screenshots to compare with; every scenario counts as new`,
    );
  } else {
    downloadScreenshots(repo, chosen.run, resolve(values.out));
    const info: ReferenceInfo = {
      branch: baseRef,
      commit: chosen.run.head_sha,
      runUrl: chosen.run.html_url,
      exact: chosen.exact,
    };
    writeFileSync(values.info, JSON.stringify(info) + '\n');
    console.error(`comparing with ${baseRef} ${info.commit} from ${info.runUrl}`);
  }
}
