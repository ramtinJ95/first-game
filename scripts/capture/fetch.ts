import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ASSETS_BRANCH,
  fetchAssetsTip,
  git,
  gitBuffer,
  remoteRepo,
  resolveBranch,
  withAssetsClone,
} from './git.ts';
import {
  assetUrl,
  declareNexusOutputs,
  imageMarkdown,
  isImage,
  MANIFEST_FILE,
  readManifest,
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
  return withAssetsClone(options.cwd, options.remote, (clone) => {
    const commit = fetchAssetsTip(clone);
    if (!commit) throw new Error(`${options.remote} has no ${ASSETS_BRANCH} branch`);
    const prefix = `${options.branch}/`;
    const paths = git(clone, ['ls-tree', '-r', '-z', '--name-only', commit, '--', prefix])
      .split('\0')
      .filter(Boolean)
      .map((path) => path.slice(prefix.length));
    if (paths.length === 0) {
      throw new Error(`${ASSETS_BRANCH} has no captures for ${options.branch}`);
    }

    rmSync(options.capturesDir, { recursive: true, force: true });
    for (const path of paths) {
      const target = join(options.capturesDir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, gitBuffer(clone, ['cat-file', 'blob', `${commit}:${prefix}${path}`]));
    }

    const captures = paths
      .filter((path) => path.endsWith(`/${MANIFEST_FILE}`))
      .map(dirname)
      .sort()
      .map((scenario) => ({
        scenario,
        entries: readManifest(join(options.capturesDir, scenario)).filter((entry) =>
          paths.includes(`${scenario}/${entry.file}`),
        ),
      }));
    const repo = remoteRepo(options.cwd, options.remote);
    const markdown = captures
      .flatMap(({ scenario, entries }) =>
        entries.map((entry) =>
          imageMarkdown(entry.title, assetUrl(repo, options.branch, scenario, entry.file)),
        ),
      )
      .join('\n\n');
    return { commit, captures, markdown: markdown + '\n' };
  });
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
