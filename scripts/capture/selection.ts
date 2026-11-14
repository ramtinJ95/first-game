import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenshotChanged } from './compare.ts';
import {
  MANIFEST_FILE,
  isImage,
  readCaptures,
  readManifest,
  type ManifestEntry,
} from './manifest.ts';

export type ScenarioVerdict =
  | { kind: 'new'; scenario: string }
  | { kind: 'named'; scenario: string }
  | { kind: 'changed'; scenario: string; changed: string[]; unchanged: string[] }
  | { kind: 'unchanged'; scenario: string };

export interface ReferenceInfo {
  branch: string;
  commit: string;
  runUrl: string;
  exact: boolean;
}

export interface Selection {
  verdicts: ScenarioVerdict[];
  reference: ReferenceInfo | null;
}

export type NamedScenarios = string[] | 'all';

export function selectCaptures(
  capturesDir: string,
  referenceDir: string | null,
  named: NamedScenarios,
): ScenarioVerdict[] {
  const captures = readCaptures(capturesDir);
  if (named !== 'all') {
    const available = captures.map(({ scenario }) => scenario);
    const unknown = named.filter((name) => !available.includes(name));
    if (unknown.length > 0) {
      throw new Error(
        `unknown scenarios named for publishing: ${unknown.join(', ')}; available: ${available.join(', ')}`,
      );
    }
  }
  return captures.map(({ scenario, entries }): ScenarioVerdict => {
    const reference = referenceDir === null ? null : join(referenceDir, scenario);
    if (reference === null || !existsSync(join(reference, MANIFEST_FILE))) {
      return { kind: 'new', scenario };
    }
    if (named === 'all' || named.includes(scenario)) return { kind: 'named', scenario };
    return compareScenario(scenario, join(capturesDir, scenario), entries, reference);
  });
}

function compareScenario(
  scenario: string,
  currentDir: string,
  entries: ManifestEntry[],
  referenceDir: string,
): ScenarioVerdict {
  const current = screenshots(entries);
  const previous = screenshots(readManifest(referenceDir));
  const changed = current.filter((file) => {
    const before = join(referenceDir, file);
    return (
      !previous.includes(file) ||
      !existsSync(before) ||
      screenshotChanged(readFileSync(join(currentDir, file)), readFileSync(before))
    );
  });
  const removed = previous.some((file) => !current.includes(file));
  if (changed.length === 0 && !removed) return { kind: 'unchanged', scenario };
  const unchanged = current.filter((file) => !changed.includes(file));
  return { kind: 'changed', scenario, changed, unchanged };
}

function screenshots(entries: ManifestEntry[]): string[] {
  return entries.filter((entry) => entry.kind === 'screenshot').map((entry) => entry.file);
}

export function publishedFiles(verdict: ScenarioVerdict, entries: ManifestEntry[]): string[] {
  switch (verdict.kind) {
    case 'new':
    case 'named':
      return entries.filter(isImage).map((entry) => entry.file);
    case 'changed':
      return entries
        .filter((entry) => entry.kind === 'clip' || verdict.changed.includes(entry.file))
        .map((entry) => entry.file);
    case 'unchanged':
      return [];
  }
}

const NAMED_LINE = /^[ \t]*publish scenarios[ \t]*:(.*)$/gim;

export function parseNamedScenarios(prBody: string): NamedScenarios {
  const names = [...prBody.matchAll(NAMED_LINE)].flatMap((match) =>
    (match[1] ?? '')
      .replaceAll('`', '')
      .split(/[\s,]+/)
      .filter(Boolean),
  );
  if (names.some((name) => name.toLowerCase() === 'all')) return 'all';
  return [...new Set(names)];
}

export function combineNamed(...lists: NamedScenarios[]): NamedScenarios {
  if (lists.includes('all')) return 'all';
  return [...new Set(lists.flatMap((list) => (list === 'all' ? [] : list)))];
}
