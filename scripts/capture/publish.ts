import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ASSETS_BRANCH, fetchAssetsTip, git, remoteRepo, resolveBranch } from './git.ts';
import {
  MANIFEST_FILE,
  isImage,
  readManifest,
  renderMarkdown,
  type ScenarioCapture,
} from './manifest.ts';

export interface PublishOptions {
  cwd: string;
  capturesDir: string;
  branch: string;
  remote: string;
}

export interface PublishResult {
  commit: string;
  changed: boolean;
  markdown: string;
}

const MAX_ATTEMPTS = 5;

export function publishCaptures(options: PublishOptions): PublishResult {
  const captures = readCaptures(options.capturesDir);
  if (captures.length === 0) throw new Error(`no captures found in ${options.capturesDir}`);
  const repo = remoteRepo(options.cwd, options.remote);

  for (let attempt = 1; ; attempt++) {
    const tip = fetchAssetsTip(options.cwd, options.remote);
    const { commit, changed } = commitCaptures(options, captures, tip);
    if (changed) {
      try {
        git(options.cwd, [
          'push',
          '--quiet',
          options.remote,
          `${commit}:refs/heads/${ASSETS_BRANCH}`,
        ]);
      } catch (error) {
        const rejected = /\brejected\b|non-fast-forward|fetch first/.test(String(error));
        if (rejected && attempt < MAX_ATTEMPTS) continue;
        throw error;
      }
    }
    return { commit, changed, markdown: renderMarkdown(repo, commit, options.branch, captures) };
  }
}

function readCaptures(capturesDir: string): ScenarioCapture[] {
  return readdirSync(capturesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort()
    .map((scenario) => ({ scenario, entries: readManifest(join(capturesDir, scenario)) }));
}

function commitCaptures(
  options: PublishOptions,
  captures: ScenarioCapture[],
  tip: string | null,
): { commit: string; changed: boolean } {
  const scratch = mkdtempSync(join(tmpdir(), 'pr-assets-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, 'index') };
    const run = (args: string[], input?: string) => git(options.cwd, args, { env, input });

    if (tip) run(['read-tree', tip]);
    const stale = run(['ls-files', '-z', '--', `${options.branch}/`]);
    if (stale) run(['update-index', '--force-remove', '-z', '--stdin'], stale);

    for (const { scenario, entries } of captures) {
      const files = [...entries.filter(isImage).map((entry) => entry.file), MANIFEST_FILE];
      for (const file of files) {
        const blob = run(['hash-object', '-w', '--', join(options.capturesDir, scenario, file)]);
        run([
          'update-index',
          '--add',
          '--cacheinfo',
          `100644,${blob},${options.branch}/${scenario}/${file}`,
        ]);
      }
    }

    const tree = run(['write-tree']);
    if (tip && run(['rev-parse', `${tip}^{tree}`]) === tree) return { commit: tip, changed: false };
    const parent = tip ? ['-p', tip] : [];
    const commit = run([
      'commit-tree',
      tree,
      ...parent,
      '-m',
      `Capture media for ${options.branch}`,
    ]);
    return { commit, changed: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { branch: { type: 'string' }, remote: { type: 'string', default: 'origin' } },
  });
  const cwd = process.cwd();
  const result = publishCaptures({
    cwd,
    capturesDir: resolve(cwd, 'captures'),
    branch: resolveBranch(cwd, values.branch),
    remote: values.remote,
  });
  console.error(
    result.changed
      ? `pushed ${result.commit} to ${ASSETS_BRANCH}`
      : `${ASSETS_BRANCH} already holds these captures at ${result.commit}`,
  );
  console.log(result.markdown);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, result.markdown);
}
