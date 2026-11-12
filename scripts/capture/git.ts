import { execFileSync } from 'node:child_process';

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

export function fetchAssetsTip(cwd: string, remote: string): string | null {
  const heads = git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${ASSETS_BRANCH}`]);
  if (!heads) return null;
  git(cwd, ['fetch', '--quiet', '--no-tags', '--depth=1', remote, `refs/heads/${ASSETS_BRANCH}`]);
  return git(cwd, ['rev-parse', 'FETCH_HEAD']);
}
