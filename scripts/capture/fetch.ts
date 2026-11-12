import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ASSETS_BRANCH, fetchAssetsTip, git, gitBuffer, remoteRepo, resolveBranch } from './git.ts';
import {
  declareNexusOutputs,
  isImage,
  MANIFEST_FILE,
  readManifest,
  renderMarkdown,
  type ScenarioCapture,
} from './manifest.ts';

export interface FetchOptions {
  cwd: string;
  capturesDir: string;
  branch: string;
  remote: string;
}

export interface FetchResult {
  commit: string;
  captures: ScenarioCapture[];
  markdown: string;
}

export function fetchCaptures(options: FetchOptions): FetchResult {
  const commit = fetchAssetsTip(options.cwd, options.remote);
  if (!commit) throw new Error(`${options.remote} has no ${ASSETS_BRANCH} branch`);
  const prefix = `${options.branch}/`;
  const paths = git(options.cwd, ['ls-tree', '-r', '-z', '--name-only', commit, '--', prefix])
    .split('\0')
    .filter(Boolean);
  if (paths.length === 0) throw new Error(`${ASSETS_BRANCH} has no captures for ${options.branch}`);

  rmSync(options.capturesDir, { recursive: true, force: true });
  const scenarios = new Set<string>();
  for (const path of paths) {
    const relative = path.slice(prefix.length);
    const target = join(options.capturesDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, gitBuffer(options.cwd, ['cat-file', 'blob', `${commit}:${path}`]));
    if (relative.endsWith(`/${MANIFEST_FILE}`)) scenarios.add(dirname(relative));
  }

  const captures = [...scenarios].sort().map((scenario) => ({
    scenario,
    entries: readManifest(join(options.capturesDir, scenario)),
  }));
  const repo = remoteRepo(options.cwd, options.remote);
  return { commit, captures, markdown: renderMarkdown(repo, commit, options.branch, captures) };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { branch: { type: 'string' }, remote: { type: 'string', default: 'origin' } },
  });
  const cwd = process.cwd();
  const capturesDir = resolve(cwd, 'captures');
  const result = fetchCaptures({
    cwd,
    capturesDir,
    branch: resolveBranch(cwd, values.branch),
    remote: values.remote,
  });
  console.error(`fetched captures from ${ASSETS_BRANCH} at ${result.commit}`);
  declareNexusOutputs(
    result.captures.flatMap(({ scenario, entries }) =>
      entries.filter(isImage).map((entry) => ({
        path: join(capturesDir, scenario, entry.file),
        title: entry.title,
      })),
    ),
  );
  console.log(result.markdown);
}
