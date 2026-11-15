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
import { picture, texture } from './png-fixture.ts';
import { publishCaptures, stageNumber, type PublishOptions } from './publish.ts';

const REMOTE_URL = 'https://github.com/acme/strategy-game.git';
const RAW = 'https://raw.githubusercontent.com/acme/strategy-game/refs/heads/pr-assets';
const REFERENCE = {
  branch: 'main',
  commit: 'c0ffee',
  runUrl: 'https://ci.example/runs/7',
  exact: true,
};

const field = picture();
const recoloured = picture((x, y) => (x < 10 && y < 10 ? texture(x, y) + 40 : texture(x, y)));

let root: string;
let work: string;
let bare: string;

function setupRepo() {
  root = mkdtempSync(join(tmpdir(), 'capture-publish-'));
  bare = join(root, 'remote.git');
  work = join(root, 'work');
  git(root, ['init', '--quiet', '--bare', bare]);
  git(bare, ['config', 'uploadpack.allowFilter', 'true']);
  git(root, ['init', '--quiet', '-b', 'main', work]);
  git(work, ['config', 'user.name', 'Capture Test']);
  git(work, ['config', 'user.email', 'capture@example.test']);
  git(work, ['remote', 'add', 'origin', REMOTE_URL]);
  git(work, ['config', `url.${bare}.insteadOf`, REMOTE_URL]);
  writeFileSync(join(work, 'game.txt'), 'committed\n');
  git(work, ['add', 'game.txt']);
  git(work, ['commit', '--quiet', '-m', 'initial']);
  writeFileSync(join(work, 'game.txt'), 'edited, unstaged\n');
}

function writeCaptures(dir: string, scenarios: Record<string, Record<string, string | Buffer>>) {
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

function publish(branch: string, options: Partial<PublishOptions> = {}) {
  return publishCaptures({
    cwd: work,
    capturesDir: join(root, 'captures'),
    branch,
    remote: 'origin',
    head: 'head-1',
    reference: null,
    named: [],
    openBranches: () => [],
    ...options,
  });
}

function assetsTree(): Record<string, string> {
  const paths = git(bare, ['ls-tree', '-r', '--name-only', 'pr-assets']).split('\n');
  return Object.fromEntries(
    paths.map((path) => [path, git(bare, ['cat-file', 'blob', `pr-assets:${path}`])]),
  );
}

function assetsCommitCount(): number {
  return Number(git(bare, ['rev-list', '--count', 'pr-assets']));
}

/** Commits files straight onto the remote's pr-assets, as a tester's push does. */
function pushToAssets(files: Record<string, string>): void {
  const env = { GIT_INDEX_FILE: join(root, 'seed-index') };
  const tip = git(bare, ['for-each-ref', '--format=%(objectname)', 'refs/heads/pr-assets']);
  if (tip) git(bare, ['read-tree', tip], { env });
  for (const [path, content] of Object.entries(files)) {
    const blob = git(bare, ['hash-object', '-w', '--stdin'], { input: content });
    git(bare, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
  }
  const tree = git(bare, ['write-tree'], { env });
  const commit = git(bare, ['commit-tree', tree, ...(tip ? ['-p', tip] : []), '-m', 'seed'], {
    env,
  });
  git(bare, ['update-ref', 'refs/heads/pr-assets', commit]);
}

/** Moves pr-assets while a publish is being received, as a rival push would. */
function raceOnReceive(rival: 'publisher' | 'tester', times: 'once' | 'always'): void {
  const script = [
    '#!/bin/sh',
    'cat >/dev/null',
    ...(times === 'once' ? [`[ -e "${root}/raced" ] && exit 0`, `touch "${root}/raced"`] : []),
    'unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES',
    `export GIT_DIR="${bare}" GIT_INDEX_FILE="${root}/rival-index"`,
    'export GIT_AUTHOR_NAME=rival GIT_AUTHOR_EMAIL=rival@example.test',
    'export GIT_COMMITTER_NAME=rival GIT_COMMITTER_EMAIL=rival@example.test',
    'git read-tree pr-assets',
    rival === 'publisher'
      ? 'path=feat/rival/fog/dark.png parent='
      : 'path=playtest/stage-six/notes.md parent="-p pr-assets"',
    'blob=$(date +%s%N | git hash-object -w --stdin)',
    'git update-index --add --cacheinfo "100644,$blob,$path"',
    'git update-ref refs/heads/pr-assets "$(git commit-tree "$(git write-tree)" $parent -m rival)"',
  ].join('\n');
  const hook = join(bare, 'hooks', 'pre-receive');
  writeFileSync(hook, script + '\n');
  chmodSync(hook, 0o755);
}

describe('publishCaptures', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const changedFromMain = () => {
    writeCaptures(join(root, 'reference'), {
      armies: { 'march.png': field, 'camp.png': field },
      fog: { 'dark.png': field },
    });
    writeCaptures(join(root, 'captures'), {
      armies: { 'march.png': recoloured, 'camp.png': field, 'clip.gif': 'gif armies' },
      fog: { 'dark.png': field, 'clip.gif': 'gif fog' },
      map: { 'start.png': 'start', 'clip.gif': 'gif map', 'video.webm': 'webm' },
    });
    return { dir: join(root, 'reference'), info: REFERENCE };
  };

  describe('against a reference from main', () => {
    let first: ReturnType<typeof publishCaptures>;
    beforeEach(() => {
      first = publish('feat/map', { reference: changedFromMain() });
    });

    it('pushes one parentless commit with only the changed and new media', () => {
      expect(first.changed).toBe(true);
      expect(assetsCommitCount()).toBe(1);
      expect(Object.keys(assetsTree()).sort()).toEqual([
        'feat/map/README.md',
        'feat/map/armies/clip.gif',
        'feat/map/armies/manifest.json',
        'feat/map/armies/march.png',
        'feat/map/map/clip.gif',
        'feat/map/map/manifest.json',
        'feat/map/map/start.png',
      ]);
      expect(assetsTree()['feat/map/map/manifest.json']).toContain('video.webm');
    });

    it('names the head and the left-out media in the README and the Markdown', () => {
      const readme = assetsTree()['feat/map/README.md'];
      expect(readme).toContain('Head: `head-1`');
      expect(readme).toContain('main `c0ffee` from https://ci.example/runs/7');
      expect(readme).toContain('![armies march.png](armies/march.png)');
      expect(readme).toContain(
        '## Left out (unchanged from the base)\n\n- `armies`: `camp.png`\n- `fog`',
      );

      const lines = first.markdown.split('\n');
      expect(lines[0]).toBe('Captures of head-1 (compared with main c0ffee)');
      expect(first.markdown).toContain(
        `![armies march.png](${RAW}/feat/map/armies/march.png)\n\n![armies clip.gif](${RAW}/feat/map/armies/clip.gif)`,
      );
      expect(first.markdown).toContain(`![map start.png](${RAW}/feat/map/map/start.png)`);
      expect(first.markdown).not.toContain('camp.png)');
      expect(first.markdown).toContain(
        '## Left out (unchanged from the base)\n\n- `armies`: `camp.png`\n- `fog`',
      );
    });

    it('replaces the branch folder on the next publish and keeps a single commit', () => {
      const second = publish('feat/map', {
        reference: changedFromMain(),
        head: 'head-2',
        named: ['fog'],
      });
      expect(second.commit).not.toBe(first.commit);
      expect(assetsCommitCount()).toBe(1);
      expect(assetsTree()).toMatchObject({
        'feat/map/fog/dark.png': expect.any(String),
        'feat/map/fog/clip.gif': 'gif fog',
        'feat/map/README.md': expect.stringContaining('Head: `head-2`'),
      });
    });

    it('does not push when the folder already holds this publish', () => {
      const rerun = publish('feat/map', { reference: changedFromMain() });
      expect(rerun).toMatchObject({ changed: false, commit: first.commit });
      expect(git(bare, ['rev-parse', 'pr-assets'])).toBe(first.commit);
    });
  });

  it('leaves the work repository as it was', () => {
    const state = () => ({
      head: git(work, ['rev-parse', 'HEAD']),
      status: git(work, ['status', '--porcelain']),
      refs: git(work, ['for-each-ref']),
      files: readdirSync(work).sort(),
    });
    const before = state();
    writeCaptures(join(root, 'captures'), { map: { 'start.png': 'start' } });
    publish('feat/map');
    expect(state()).toEqual(before);
  });

  it('keeps open pull requests and the newest playtest stage, and drops the rest', () => {
    pushToAssets({
      'feat/open/fog/dark.png': 'open',
      'feat/closed/fog/dark.png': 'closed',
      'playtest/stage-four/notes.md': 'four',
    });
    pushToAssets({ 'playtest/stage-five/notes.md': 'five', 'playtest/stage-two/notes.md': 'two' });
    const openTree = git(bare, ['rev-parse', 'pr-assets:feat/open']);

    writeCaptures(join(root, 'captures'), { map: { 'start.png': 'start' } });
    publish('feat/map', { openBranches: () => ['feat/open', 'feat/map', 'feat/never-published'] });

    expect(assetsCommitCount()).toBe(1);
    expect(git(bare, ['rev-parse', 'pr-assets:feat/open'])).toBe(openTree);
    expect(Object.keys(assetsTree()).sort()).toEqual([
      'feat/map/README.md',
      'feat/map/map/manifest.json',
      'feat/map/map/start.png',
      'feat/open/fog/dark.png',
      'playtest/stage-five/notes.md',
    ]);
  });

  it('rebuilds on the rival publish that landed first and keeps its folder', () => {
    writeCaptures(join(root, 'captures'), { map: { 'start.png': 'start' } });
    publish('feat/map');
    raceOnReceive('publisher', 'once');
    const openLists = [[], ['feat/rival']];

    publish('feat/map', { head: 'head-2', openBranches: () => openLists.shift() ?? [] });

    expect(assetsCommitCount()).toBe(1);
    expect(Object.keys(assetsTree()).sort()).toEqual([
      'feat/map/README.md',
      'feat/map/map/manifest.json',
      'feat/map/map/start.png',
      'feat/rival/fog/dark.png',
    ]);
    expect(assetsTree()['feat/map/README.md']).toContain('head-2');
  });

  it('keeps a playtest stage pushed while it published as the newest stage', () => {
    pushToAssets({ 'playtest/stage-five/notes.md': 'five' });
    raceOnReceive('tester', 'once');
    writeCaptures(join(root, 'captures'), { map: { 'start.png': 'start' } });

    publish('feat/map');

    expect(assetsCommitCount()).toBe(1);
    expect(Object.keys(assetsTree()).filter((path) => path.startsWith('playtest/'))).toEqual([
      'playtest/stage-six/notes.md',
    ]);
  });

  it('gives up when the branch moves under every attempt', () => {
    pushToAssets({ 'playtest/stage-five/notes.md': 'five' });
    raceOnReceive('tester', 'always');
    writeCaptures(join(root, 'captures'), { map: { 'start.png': 'start' } });

    expect(() => publish('feat/map')).toThrow('pr-assets moved under each of 5 publishes');
  });
});

describe('fetchCaptures', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('fetches the published folder of a branch and drops stale local captures', () => {
    writeCaptures(join(root, 'captures'), {
      placeholder: { 'start.png': 'start', 'clip.gif': 'gif', 'video.webm': 'webm' },
    });
    publish('feat/map');
    writeCaptures(join(root, 'captures'), { armies: { 'march.png': 'march' } });
    const latest = publish('feat/armies', { openBranches: () => ['feat/map'] });

    const fetched = join(root, 'fetched');
    mkdirSync(join(fetched, 'stale'), { recursive: true });
    const result = fetchCaptures({
      cwd: work,
      capturesDir: fetched,
      branch: 'feat/map',
      remote: 'origin',
    });

    expect(result.commit).toBe(latest.commit);
    expect(readdirSync(fetched).sort()).toEqual(['README.md', 'placeholder']);
    expect(readFileSync(join(fetched, 'placeholder', 'start.png'), 'utf8')).toBe('start');
    expect(result.captures).toEqual([
      {
        scenario: 'placeholder',
        entries: [
          { file: 'start.png', title: 'placeholder start.png', kind: 'screenshot' },
          { file: 'clip.gif', title: 'placeholder clip.gif', kind: 'clip' },
        ],
      },
    ]);
    expect(result.markdown).toBe(
      `![placeholder start.png](${RAW}/feat/map/placeholder/start.png)\n\n![placeholder clip.gif](${RAW}/feat/map/placeholder/clip.gif)\n`,
    );
  });

  it('refuses to fetch a branch that has no captures', () => {
    writeCaptures(join(root, 'captures'), { placeholder: { 'start.png': 'start' } });
    publish('feat/map');

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

describe('stageNumber', () => {
  it.each([
    ['stage-five', 5],
    ['stage-twenty', 20],
    ['stage-12', 12],
    ['stage-Three', 3],
    ['stage-final', null],
    ['notes', null],
  ])('reads %s as %s', (name, number) => {
    expect(stageNumber(name)).toBe(number);
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
