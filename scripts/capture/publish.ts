import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as v from 'valibot';
import {
  ASSETS_BRANCH,
  fetchAssetsTip,
  git,
  remoteRepo,
  resolveBranch,
  withAssetsClone,
  type GitHubRepo,
} from './git.ts';
import { MANIFEST_FILE, readCaptures } from './manifest.ts';
import { renderReadme, renderSummary, type Report } from './report.ts';
import {
  combineNamed,
  parseNamedScenarios,
  publishedFiles,
  selectCaptures,
  type NamedScenarios,
  type ReferenceInfo,
  type Selection,
} from './selection.ts';

export interface PublishOptions {
  cwd: string;
  capturesDir: string;
  branch: string;
  remote: string;
  head: string;
  base?: string;
  runUrl?: string;
  reference: { dir: string; info: ReferenceInfo } | null;
  named: NamedScenarios;
  /** Head branches of this repository's open pull requests; only their folders survive. */
  openBranches: readonly string[];
}

export interface PublishResult {
  commit: string;
  changed: boolean;
  markdown: string;
  selection: Selection;
}

export const MAX_ATTEMPTS = 5;

interface TreeEntry {
  mode: '100644' | '040000';
  type: 'blob' | 'tree';
  sha: string;
}

export function publishCaptures(options: PublishOptions): PublishResult {
  const captures = readCaptures(options.capturesDir);
  if (captures.length === 0) throw new Error(`no captures found in ${options.capturesDir}`);
  const selection: Selection = {
    verdicts: selectCaptures(options.capturesDir, options.reference?.dir ?? null, options.named),
    reference: options.reference?.info ?? null,
  };
  const report: Report = {
    repo: remoteRepo(options.cwd, options.remote),
    branch: options.branch,
    head: options.head,
    base: options.base,
    runUrl: options.runUrl,
    reference: selection.reference,
    scenarios: selection.verdicts.map((verdict) => {
      const entries = captures.find(({ scenario }) => scenario === verdict.scenario)?.entries ?? [];
      const files = publishedFiles(verdict, entries);
      return { verdict, images: entries.filter((entry) => files.includes(entry.file)) };
    }),
  };
  const markdown = renderSummary(report);

  return withAssetsClone(options.cwd, options.remote, (clone) => {
    const folder = writeBranchFolder(clone, options.capturesDir, report);
    for (let attempt = 1; ; attempt++) {
      const tip = fetchAssetsTip(clone);
      const tree = writeTree(clone, keptFolders(clone, tip, options, folder));
      if (tip && tree === git(clone, ['rev-parse', `${tip}^{tree}`]) && !hasParent(clone, tip)) {
        return { commit: tip, changed: false, markdown, selection };
      }
      const commit = git(clone, [
        'commit-tree',
        tree,
        '-m',
        `Capture media for ${options.branch} at ${options.head}`,
      ]);
      try {
        git(clone, [
          'push',
          '--quiet',
          `--force-with-lease=refs/heads/${ASSETS_BRANCH}:${tip ?? ''}`,
          'origin',
          `${commit}:refs/heads/${ASSETS_BRANCH}`,
        ]);
      } catch (error) {
        if (!/stale info|cannot lock ref|failed to update ref/.test(String(error))) throw error;
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(`${ASSETS_BRANCH} moved under each of ${MAX_ATTEMPTS} publishes`, {
            cause: error,
          });
        }
        // A random pause keeps two publishers that collided from colliding again.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.random() * 200 * attempt);
        continue;
      }
      return { commit, changed: true, markdown, selection };
    }
  });
}

function writeBranchFolder(clone: string, capturesDir: string, report: Report): TreeEntry {
  const files = report.scenarios.flatMap(({ verdict: { scenario }, images }) =>
    images.length === 0
      ? []
      : [MANIFEST_FILE, ...images.map((image) => image.file)].map((file) => ({
          path: `${scenario}/${file}`,
          source: join(capturesDir, scenario, file),
        })),
  );
  const blobs = files.length
    ? git(clone, ['hash-object', '-w', '--stdin-paths'], {
        input: files.map(({ source }) => source).join('\n') + '\n',
      }).split('\n')
    : [];
  const entries = new Map<string, TreeEntry>(
    files.map(({ path }, i) => [path, { mode: '100644', type: 'blob', sha: blobs[i] ?? '' }]),
  );
  const readme = git(clone, ['hash-object', '-w', '--stdin'], { input: renderReadme(report) });
  entries.set('README.md', { mode: '100644', type: 'blob', sha: readme });
  return { mode: '040000', type: 'tree', sha: writeTree(clone, entries) };
}

function keptFolders(
  clone: string,
  tip: string | null,
  options: PublishOptions,
  folder: TreeEntry,
): Map<string, TreeEntry> {
  const kept = new Map<string, TreeEntry>();
  if (tip) {
    for (const branch of options.openBranches) {
      const entry = treeAt(clone, tip, branch);
      if (entry) kept.set(branch, entry);
    }
    const stage = newestStage(clone, tip);
    if (stage) kept.set(stage.path, stage.entry);
  }
  kept.set(options.branch, folder);
  return kept;
}

function treeAt(clone: string, tip: string, path: string): TreeEntry | null {
  const entry = listTree(clone, tip, path)[0];
  return entry?.type === 'tree' && entry.path === path ? entry : null;
}

function listTree(clone: string, tip: string, path: string) {
  return git(clone, ['ls-tree', '-z', tip, '--', path])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta = '', entryPath = ''] = line.split('\t');
      const [mode, type, sha = ''] = meta.split(' ');
      return {
        mode: mode === '040000' ? ('040000' as const) : ('100644' as const),
        type: type === 'tree' ? ('tree' as const) : ('blob' as const),
        sha,
        path: entryPath,
      };
    });
}

const STAGE_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

export function stageNumber(name: string): number | null {
  const stage = /^stage-(\w+)$/.exec(name)?.[1]?.toLowerCase();
  if (stage === undefined) return null;
  if (/^\d+$/.test(stage)) return Number(stage);
  const index = STAGE_WORDS.indexOf(stage);
  return index < 0 ? null : index + 1;
}

function newestStage(clone: string, tip: string): { path: string; entry: TreeEntry } | null {
  let newest: { path: string; entry: TreeEntry; number: number } | null = null;
  for (const entry of listTree(clone, tip, 'playtest/')) {
    const number = stageNumber(entry.path.slice('playtest/'.length));
    if (entry.type === 'tree' && number !== null && (!newest || number > newest.number)) {
      newest = { path: entry.path, entry, number };
    }
  }
  return newest;
}

function writeTree(clone: string, entries: Map<string, TreeEntry>): string {
  const direct = new Map<string, TreeEntry>();
  const nested = new Map<string, Map<string, TreeEntry>>();
  for (const [path, entry] of entries) {
    const slash = path.indexOf('/');
    if (slash < 0) {
      direct.set(path, entry);
      continue;
    }
    const name = path.slice(0, slash);
    const children = nested.get(name) ?? new Map<string, TreeEntry>();
    children.set(path.slice(slash + 1), entry);
    nested.set(name, children);
  }
  for (const [name, children] of nested) {
    if (direct.has(name))
      throw new Error(`${name} is both a folder and a file in ${ASSETS_BRANCH}`);
    direct.set(name, { mode: '040000', type: 'tree', sha: writeTree(clone, children) });
  }
  const listing = [...direct].map(
    ([name, entry]) => `${entry.mode} ${entry.type} ${entry.sha}\t${name}\n`,
  );
  return git(clone, ['mktree'], { input: listing.join('') });
}

function hasParent(clone: string, commit: string): boolean {
  return /^parent /m.test(git(clone, ['cat-file', 'commit', commit]));
}

const OpenPulls = v.array(
  v.object({
    head: v.object({ ref: v.string(), repo: v.nullable(v.object({ full_name: v.string() })) }),
  }),
);

export async function listOpenBranches(repo: GitHubRepo, token: string | undefined) {
  if (!token) {
    throw new Error('listing open pull requests needs GITHUB_TOKEN or GH_TOKEN in the environment');
  }
  const fullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const branches: string[] = [];
  let url: string | null =
    `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?state=open&per_page=100`;
  while (url) {
    const response: Response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'capture-publish',
      },
    });
    if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
    for (const pull of v.parse(OpenPulls, await response.json())) {
      if (pull.head.repo?.full_name.toLowerCase() === fullName) branches.push(pull.head.ref);
    }
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1] ?? null;
  }
  return branches;
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`--reference needs ${flag}`);
  return value;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      branch: { type: 'string' },
      remote: { type: 'string', default: 'origin' },
      head: { type: 'string' },
      base: { type: 'string' },
      'run-url': { type: 'string' },
      reference: { type: 'string' },
      'reference-commit': { type: 'string' },
      'reference-run-url': { type: 'string' },
      'reference-exact': { type: 'boolean', default: false },
      scenario: { type: 'string', multiple: true, default: [] },
      'pr-body-file': { type: 'string' },
    },
  });
  const cwd = process.cwd();
  const prBody = values['pr-body-file'] ? readFileSync(values['pr-body-file'], 'utf8') : '';
  const result = publishCaptures({
    cwd,
    capturesDir: resolve(cwd, 'captures'),
    branch: resolveBranch(cwd, values.branch),
    remote: values.remote,
    head: values.head ?? git(cwd, ['rev-parse', 'HEAD']),
    base: values.base,
    runUrl: values['run-url'],
    reference: values.reference
      ? {
          dir: resolve(cwd, values.reference),
          info: {
            commit: required(values['reference-commit'], '--reference-commit'),
            runUrl: required(values['reference-run-url'], '--reference-run-url'),
            exact: values['reference-exact'],
          },
        }
      : null,
    named: combineNamed(values.scenario, parseNamedScenarios(prBody)),
    openBranches: await listOpenBranches(
      remoteRepo(cwd, values.remote),
      process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'],
    ),
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
