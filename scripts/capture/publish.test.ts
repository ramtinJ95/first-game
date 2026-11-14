import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchCaptures } from './fetch.ts';
import { git, parseGitHubRemote } from './git.ts';
import type { ManifestEntry } from './manifest.ts';
import { publishCaptures } from './publish.ts';

const REMOTE_URL = 'https://github.com/acme/strategy-game.git';

let root: string;
let work: string;
let bare: string;

function setupRepo() {
  root = mkdtempSync(join(tmpdir(), 'capture-publish-'));
  bare = join(root, 'remote.git');
  work = join(root, 'work');
  git(root, ['init', '--quiet', '--bare', bare]);
  git(root, ['init', '--quiet', '-b', 'main', work]);
  git(work, ['config', 'user.name', 'Capture Test']);
  git(work, ['config', 'user.email', 'capture@example.test']);
  git(work, ['remote', 'add', 'origin', REMOTE_URL]);
  git(work, ['config', `url.${bare}.insteadOf`, REMOTE_URL]);
  writeFileSync(join(work, 'game.txt'), 'committed\n');
  git(work, ['add', 'game.txt']);
  git(work, ['commit', '--quiet', '-m', 'initial']);
  writeFileSync(join(work, 'game.txt'), 'edited, unstaged\n');
  writeFileSync(join(work, 'staged.txt'), 'staged\n');
  git(work, ['add', 'staged.txt']);
}

function writeCaptures(dir: string, scenarios: Record<string, Record<string, string>>): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [scenario, shots] of Object.entries(scenarios)) {
    mkdirSync(join(dir, scenario), { recursive: true });
    const manifest: ManifestEntry[] = [];
    for (const [file, content] of Object.entries(shots)) {
      writeFileSync(join(dir, scenario, file), content);
      const kind = file.endsWith('.gif') ? 'clip' : file.endsWith('.png') ? 'screenshot' : 'video';
      manifest.push({ file, title: `${scenario} ${file}`, kind });
    }
    writeFileSync(join(dir, scenario, 'manifest.json'), JSON.stringify(manifest));
  }
}

function assetsTree(): Record<string, string> {
  const tip = git(bare, ['rev-parse', 'pr-assets']);
  const paths = git(bare, ['ls-tree', '-r', '--name-only', tip]).split('\n');
  return Object.fromEntries(
    paths.map((path) => [path, git(bare, ['cat-file', 'blob', `${tip}:${path}`])]),
  );
}

function assetsCommitCount(): number {
  return Number(git(bare, ['rev-list', '--count', 'pr-assets']));
}

function workState() {
  return {
    head: git(work, ['rev-parse', 'HEAD']),
    branch: git(work, ['branch', '--show-current']),
    status: git(work, ['status', '--porcelain']),
    staged: git(work, ['diff', '--cached', '--name-only']),
    localBranches: git(work, ['branch', '--format=%(refname:short)']),
    files: readdirSync(work).sort(),
  };
}

describe('publishCaptures and fetchCaptures', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const publish = (branch: string) =>
    publishCaptures({ cwd: work, capturesDir: join(root, 'captures'), branch, remote: 'origin' });

  // These are real git integration checks, not a wait on a timer. Keep one operation
  // under test per case instead of charging five publishes and a fetch to one deadline.
  describe('with a published branch', () => {
    let first: ReturnType<typeof publishCaptures>;
    let before: ReturnType<typeof workState>;
    beforeEach(() => {
      before = workState();
      writeCaptures(join(root, 'captures'), {
        placeholder: {
          'start.png': 'start v1',
          'later.png': 'later v1',
          'clip.gif': 'gif v1',
          'video.webm': 'webm',
        },
      });
      first = publish('feat/map');
    });
    afterEach(() => expect(workState()).toEqual(before));

    it('publishes images and a manifest with immutable Markdown links', () => {
      expect(first.changed).toBe(true);
      expect(assetsTree()).toEqual({
        'feat/map/placeholder/start.png': 'start v1',
        'feat/map/placeholder/later.png': 'later v1',
        'feat/map/placeholder/clip.gif': 'gif v1',
        'feat/map/placeholder/manifest.json': expect.stringContaining('video.webm'),
      });
      expect(first.markdown).toBe(
        [
          `![placeholder start.png](https://raw.githubusercontent.com/acme/strategy-game/${first.commit}/feat/map/placeholder/start.png)`,
          `![placeholder later.png](https://raw.githubusercontent.com/acme/strategy-game/${first.commit}/feat/map/placeholder/later.png)`,
          `![placeholder clip.gif](https://raw.githubusercontent.com/acme/strategy-game/${first.commit}/feat/map/placeholder/clip.gif)`,
        ].join('\n\n') + '\n',
      );
    });

    it('replaces changed files and removes stale files from only that branch', () => {
      writeCaptures(join(root, 'captures'), {
        placeholder: { 'start.png': 'start v2', 'clip.gif': 'gif v2' },
      });
      const second = publish('feat/map');
      expect(second.commit).not.toBe(first.commit);
      expect(git(bare, ['rev-parse', 'pr-assets^'])).toBe(first.commit);
      expect(Object.keys(assetsTree()).sort()).toEqual([
        'feat/map/placeholder/clip.gif',
        'feat/map/placeholder/manifest.json',
        'feat/map/placeholder/start.png',
      ]);
    });

    it('preserves another branch when publishing a new branch', () => {
      writeCaptures(join(root, 'captures'), { armies: { 'march.png': 'march' } });
      const other = publish('feat/armies');
      expect(other.changed).toBe(true);
      expect(assetsTree()).toMatchObject({
        'feat/map/placeholder/start.png': 'start v1',
        'feat/map/placeholder/clip.gif': 'gif v1',
        'feat/armies/armies/march.png': 'march',
      });
    });

    it('does not commit or push when the branch captures have not changed', () => {
      const commits = assetsCommitCount();
      const rerun = publish('feat/map');
      expect(rerun).toMatchObject({ changed: false, commit: first.commit });
      expect(assetsCommitCount()).toBe(commits);
    });

    describe('after updates and another branch advance the remote tip', () => {
      let latest: ReturnType<typeof publishCaptures>;
      beforeEach(() => {
        writeCaptures(join(root, 'captures'), {
          placeholder: { 'start.png': 'start v2', 'clip.gif': 'gif v2' },
        });
        publish('feat/map');
        writeCaptures(join(root, 'captures'), { armies: { 'march.png': 'march' } });
        latest = publish('feat/armies');
      });

      it('fetches the requested branch at the latest tip and removes stale local captures', () => {
        const fetched = join(root, 'fetched');
        mkdirSync(join(fetched, 'stale'), { recursive: true });
        const result = fetchCaptures({
          cwd: work,
          capturesDir: fetched,
          branch: 'feat/map',
          remote: 'origin',
        });
        expect(result.commit).toBe(latest.commit);
        expect(readdirSync(fetched)).toEqual(['placeholder']);
        expect(readFileSync(join(fetched, 'placeholder', 'start.png'), 'utf8')).toBe('start v2');
        expect(result.captures).toEqual([
          {
            scenario: 'placeholder',
            entries: [
              { file: 'start.png', title: 'placeholder start.png', kind: 'screenshot' },
              { file: 'clip.gif', title: 'placeholder clip.gif', kind: 'clip' },
            ],
          },
        ]);
        expect(result.markdown).toContain(
          `https://raw.githubusercontent.com/acme/strategy-game/${latest.commit}/feat/map/placeholder/clip.gif`,
        );
      });
    });
  });

  it('rebuilds on the newer tip when another publisher pushes first', () => {
    const captures = join(root, 'captures');
    writeCaptures(captures, { placeholder: { 'start.png': 'start' } });
    publishCaptures({ cwd: work, capturesDir: captures, branch: 'feat/map', remote: 'origin' });

    const rival = [
      '#!/bin/sh',
      `[ -e "${root}/raced" ] && exit 0`,
      `touch "${root}/raced"`,
      `export GIT_DIR="${bare}" GIT_INDEX_FILE="${root}/rival-index"`,
      'export GIT_AUTHOR_NAME=rival GIT_AUTHOR_EMAIL=rival@example.test',
      'export GIT_COMMITTER_NAME=rival GIT_COMMITTER_EMAIL=rival@example.test',
      'git read-tree pr-assets',
      'blob=$(printf rival | git hash-object -w --stdin)',
      'git update-index --add --cacheinfo "100644,$blob,feat/rival/placeholder/start.png"',
      'git update-ref refs/heads/pr-assets "$(git commit-tree "$(git write-tree)" -p pr-assets -m rival)"',
    ].join('\n');
    const hook = join(work, '.git', 'hooks', 'pre-push');
    writeFileSync(hook, rival + '\n');
    chmodSync(hook, 0o755);

    writeCaptures(captures, { placeholder: { 'start.png': 'start v2' } });
    const result = publishCaptures({
      cwd: work,
      capturesDir: captures,
      branch: 'feat/map',
      remote: 'origin',
    });

    expect(git(bare, ['log', '-1', '--format=%an', 'pr-assets^'])).toBe('rival');
    expect(git(bare, ['rev-parse', 'pr-assets'])).toBe(result.commit);
    expect(assetsTree()).toMatchObject({
      'feat/map/placeholder/start.png': 'start v2',
      'feat/rival/placeholder/start.png': 'rival',
    });
  });

  it('refuses to fetch a branch that has no captures', () => {
    const captures = join(root, 'captures');
    writeCaptures(captures, { placeholder: { 'start.png': 'start' } });
    publishCaptures({ cwd: work, capturesDir: captures, branch: 'feat/map', remote: 'origin' });

    expect(() =>
      fetchCaptures({
        cwd: work,
        capturesDir: join(root, 'fetched'),
        branch: 'feat/none',
        remote: 'origin',
      }),
    ).toThrow(/no captures for feat\/none/);
  });
});

describe('parseGitHubRemote', () => {
  it.each([
    'https://github.com/acme/strategy-game.git',
    'https://github.com/acme/strategy-game',
    'https://x-access-token@github.com/acme/strategy-game.git',
    'git@github.com:acme/strategy-game.git',
    'ssh://git@github.com/acme/strategy-game.git',
  ])('reads owner and repo from %s', (url) => {
    expect(parseGitHubRemote(url)).toEqual({ owner: 'acme', name: 'strategy-game' });
  });

  it('keeps dots inside the repo name', () => {
    expect(parseGitHubRemote('git@github.com:acme/game.io.git')).toEqual({
      owner: 'acme',
      name: 'game.io',
    });
  });

  it('rejects remotes outside GitHub', () => {
    expect(() => parseGitHubRemote('https://gitlab.com/acme/strategy-game.git')).toThrow();
  });
});
