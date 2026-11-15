import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ASSETS_BRANCH = 'pr-assets';

export interface GitOptions {
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
}

export function git(cwd: string, args: string[], options: GitOptions = {}): string {
  return gitBuffer(cwd, args, options).toString('utf8').trim();
}

export function gitBuffer(cwd: string, args: string[], options: GitOptions = {}): Buffer {
  try {
    return execFileSync('git', args, {
      cwd,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', ...options.env },
      input: options.input,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`, {
      cause: error,
    });
  }
}

export interface GitHubRepo {
  owner: string;
  name: string;
}

const GITHUB_REMOTE =
  /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export function parseGitHubRemote(url: string): GitHubRepo {
  const match = GITHUB_REMOTE.exec(url.trim());
  if (!match?.[1] || !match[2]) throw new Error(`not a GitHub remote URL: ${url}`);
  return { owner: match[1], name: match[2] };
}

export function remoteRepo(cwd: string, remote: string): GitHubRepo {
  // The configured URL, not `git remote get-url`, which applies insteadOf rewrites.
  return parseGitHubRemote(git(cwd, ['config', '--get', `remote.${remote}.url`]));
}

export function resolveBranch(cwd: string, flag: string | undefined): string {
  const branch = flag || process.env['GITHUB_HEAD_REF'] || git(cwd, ['branch', '--show-current']);
  if (!branch)
    throw new Error('no branch: pass --branch, set GITHUB_HEAD_REF, or check out a branch');
  git(cwd, ['check-ref-format', '--branch', branch]);
  return branch;
}

/**
 * Runs `use` in a scratch bare repository that is a blob-less partial clone of the remote,
 * so reading the assets branch downloads its trees but no images.
 */
export function withAssetsClone<T>(cwd: string, remote: string, use: (clone: string) => T): T {
  const clone = mkdtempSync(join(tmpdir(), 'pr-assets-'));
  try {
    git(clone, ['init', '--quiet', '--bare']);
    const settings: [string, string][] = [
      ['core.repositoryformatversion', '1'],
      ['extensions.partialClone', 'origin'],
      ['remote.origin.url', git(cwd, ['config', '--get', `remote.${remote}.url`])],
      ['remote.origin.promisor', 'true'],
      ['remote.origin.partialclonefilter', 'blob:none'],
      ...carriedSettings(cwd),
    ];
    for (const [key, value] of settings) git(clone, ['config', '--add', key, value]);
    return use(clone);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

// CI's push credentials and local insteadOf rewrites live in the work repository's own config.
function carriedSettings(cwd: string): [string, string][] {
  let listing: string;
  try {
    listing = git(cwd, [
      'config',
      '--local',
      '--includes',
      '--null',
      '--get-regexp',
      '^(url|http|user)\\.',
    ]);
  } catch {
    return [];
  }
  return listing.split('\0').flatMap((entry): [string, string][] => {
    const newline = entry.indexOf('\n');
    return newline < 0 ? [] : [[entry.slice(0, newline), entry.slice(newline + 1)]];
  });
}

export function fetchAssetsTip(clone: string): string | null {
  const ref = `refs/heads/${ASSETS_BRANCH}`;
  if (!git(clone, ['ls-remote', '--heads', 'origin', ref])) return null;
  git(clone, ['fetch', '--quiet', '--no-tags', '--filter=blob:none', '--depth=1', 'origin', ref]);
  return git(clone, ['rev-parse', 'FETCH_HEAD']);
}
