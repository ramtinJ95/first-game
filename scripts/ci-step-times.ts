import { parseArgs } from 'node:util';

/**
 * Prints how long each CI job's steps named like `--step`, the Chromium install by default, took over the last `--runs` runs of the
 * CI workflow, from the GitHub API's step timings: the median, the slowest, and how many took more
 * than a minute, by job. `--run <id>` reads one run instead. Reads GH_TOKEN.
 */
const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '20' },
    run: { type: 'string' },
    step: { type: 'string', default: 'chromium' },
    repo: { type: 'string', default: 'ramtinJ95/first-game' },
  },
});
const token = process.env['GH_TOKEN'];
if (!token) throw new Error('GH_TOKEN is not set');
const api = async <T>(path: string): Promise<T> => {
  const response = await fetch(`https://api.github.com/repos/${values.repo}/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
};
interface Step {
  name: string;
  started_at: string | null;
  completed_at: string | null;
}
interface Job {
  name: string;
  steps?: Step[];
}
const ids = values.run
  ? [Number(values.run)]
  : (
      await api<{ workflow_runs: { id: number; status: string }[] }>(
        `actions/workflows/ci.yml/runs?per_page=${values.runs}&status=completed`,
      )
    ).workflow_runs.map((run) => run.id);
const byJob = new Map<string, number[]>();
for (const id of ids) {
  const { jobs } = await api<{ jobs: Job[] }>(`actions/runs/${id}/jobs?per_page=100`);
  for (const job of jobs)
    for (const step of job.steps ?? []) {
      if (step.name.startsWith('Post ')) continue;
      if (!step.name.toLowerCase().includes(values.step.toLowerCase())) continue;
      if (!step.started_at || !step.completed_at) continue;
      const seconds = (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000;
      const kind = job.name.replace(/ \(\d+\)$/, '');
      byJob.set(kind, [...(byJob.get(kind) ?? []), seconds]);
    }
}
console.log(`Steps matching "${values.step}" over ${ids.length} runs`);
console.log('| Job | Steps | Median (s) | Slowest (s) | Over 60 s |');
console.log('| --- | --- | --- | --- | --- |');
for (const [job, all] of [...byJob].sort()) {
  const sorted = [...all].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(
    `| ${job} | ${sorted.length} | ${median} | ${sorted.at(-1) ?? 0} | ${sorted.filter((s) => s > 60).length} |`,
  );
}
