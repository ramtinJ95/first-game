import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS_BRANCH, type GitHubRepo } from './git.ts';

export const MANIFEST_FILE = 'manifest.json';

export type AssetKind = 'screenshot' | 'clip' | 'video' | 'trace';

export interface ManifestEntry {
  file: string;
  title: string;
  kind: AssetKind;
}

export interface ScenarioCapture {
  scenario: string;
  entries: ManifestEntry[];
}

const KINDS: readonly string[] = ['screenshot', 'clip', 'video', 'trace'] satisfies AssetKind[];

export function readManifest(scenarioDir: string): ManifestEntry[] {
  const path = join(scenarioDir, MANIFEST_FILE);
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw) || !raw.every(isManifestEntry)) {
    throw new Error(`${path} is not an array of { file, title, kind } entries`);
  }
  return raw;
}

export function readCaptures(capturesDir: string): ScenarioCapture[] {
  return readdirSync(capturesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort()
    .map((scenario) => ({ scenario, entries: readManifest(join(capturesDir, scenario)) }));
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { file, title, kind } = value as Record<string, unknown>;
  return (
    typeof file === 'string' &&
    /^[\w.-]+$/.test(file) &&
    typeof title === 'string' &&
    typeof kind === 'string' &&
    KINDS.includes(kind)
  );
}

export function isImage(entry: ManifestEntry): boolean {
  return entry.kind === 'screenshot' || entry.kind === 'clip';
}

export function assetUrl(repo: GitHubRepo, branch: string, scenario: string, file: string): string {
  const path = [ASSETS_BRANCH, ...branch.split('/'), scenario, file]
    .map(encodeURIComponent)
    .join('/');
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/refs/heads/${path}`;
}

export function imageMarkdown(title: string, url: string): string {
  return `![${title.replace(/[[\]]/g, '\\$&')}](${url})`;
}

export interface NexusOutput {
  path: string;
  title: string;
}

export function declareNexusOutputs(outputs: NexusOutput[]): void {
  for (const [i, output] of outputs.entries()) {
    const result = spawnSync(
      'nexus',
      ['output', 'add', 'file', output.path, '--title', output.title],
      { encoding: 'utf8' },
    );
    if (i === 0 && (result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      console.log('nexus is not on PATH; skipping output declarations');
      return;
    }
    if (result.error || result.status !== 0) {
      console.warn(`nexus output add failed for ${output.path}: ${result.stderr || result.error}`);
    }
  }
}
