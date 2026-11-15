import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestEntry } from './manifest.ts';
import { picture, texture } from './png-fixture.ts';
import {
  parseNamedScenarios,
  publishedFiles,
  selectCaptures,
  type ScenarioVerdict,
} from './selection.ts';

const field = picture();
const recoloured = picture((x, y) => (x < 10 && y < 10 ? texture(x, y) + 40 : texture(x, y)));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'capture-selection-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeScenario(dir: string, scenario: string, files: Record<string, Buffer>): void {
  mkdirSync(join(dir, scenario), { recursive: true });
  const manifest: ManifestEntry[] = Object.entries(files).map(([file, content]) => {
    writeFileSync(join(dir, scenario, file), content);
    return { file, title: file, kind: file.endsWith('.gif') ? 'clip' : 'screenshot' };
  });
  writeFileSync(join(dir, scenario, 'manifest.json'), JSON.stringify(manifest));
}

function published(verdicts: ScenarioVerdict[], current: Record<string, Record<string, Buffer>>) {
  return Object.fromEntries(
    verdicts.map((verdict) => [
      verdict.scenario,
      publishedFiles(
        verdict,
        Object.keys(current[verdict.scenario] ?? {}).map((file) => ({
          file,
          title: file,
          kind: file.endsWith('.gif') ? 'clip' : 'screenshot',
        })),
      ),
    ]),
  );
}

describe('selectCaptures', () => {
  const gif = Buffer.from('gif');
  const current = {
    map: { 'start.png': field, 'clip.gif': gif },
    armies: { 'march.png': recoloured, 'camp.png': field, 'clip.gif': gif },
    fog: { 'dark.png': field, 'clip.gif': gif },
  };
  const captures = () => join(root, 'captures');
  const reference = () => join(root, 'reference');

  beforeEach(() => {
    for (const [scenario, files] of Object.entries(current)) {
      writeScenario(captures(), scenario, files);
    }
    writeScenario(reference(), 'armies', { 'march.png': field, 'camp.png': field });
    writeScenario(reference(), 'fog', { 'dark.png': field });
  });

  it('publishes every scenario whole without a reference', () => {
    const verdicts = selectCaptures(captures(), null, []);
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(['new', 'new', 'new']);
    expect(published(verdicts, current)).toEqual({
      armies: ['march.png', 'camp.png', 'clip.gif'],
      fog: ['dark.png', 'clip.gif'],
      map: ['start.png', 'clip.gif'],
    });
  });

  it('publishes a scenario main lacks whole, changed shots with the clip, and nothing unchanged', () => {
    const verdicts = selectCaptures(captures(), reference(), []);
    expect(verdicts).toEqual([
      { kind: 'changed', scenario: 'armies', changed: ['march.png'], unchanged: ['camp.png'] },
      { kind: 'unchanged', scenario: 'fog' },
      { kind: 'new', scenario: 'map' },
    ]);
    expect(published(verdicts, current)).toEqual({
      armies: ['march.png', 'clip.gif'],
      fog: [],
      map: ['start.png', 'clip.gif'],
    });
  });

  it('publishes a named scenario whole even when unchanged', () => {
    const verdicts = selectCaptures(captures(), reference(), ['fog']);
    expect(verdicts[1]).toEqual({ kind: 'named', scenario: 'fog' });
    expect(published(verdicts, current).fog).toEqual(['dark.png', 'clip.gif']);
    expect(selectCaptures(captures(), reference(), 'all').map((verdict) => verdict.kind)).toEqual([
      'named',
      'named',
      'new',
    ]);
  });

  it('counts a screenshot main lacks as changed', () => {
    writeScenario(reference(), 'fog', { 'other.png': field });
    expect(selectCaptures(captures(), reference(), [])[1]).toEqual({
      kind: 'changed',
      scenario: 'fog',
      changed: ['dark.png'],
      unchanged: [],
    });
  });

  it('shows the clip when a screenshot on main is gone', () => {
    writeScenario(reference(), 'fog', { 'dark.png': field, 'gone.png': field });
    const verdicts = selectCaptures(captures(), reference(), []);
    expect(verdicts[1]).toEqual({
      kind: 'changed',
      scenario: 'fog',
      changed: [],
      unchanged: ['dark.png'],
    });
    expect(published(verdicts, current).fog).toEqual(['clip.gif']);
  });

  it('rejects an unknown scenario name and lists the available ones', () => {
    expect(() => selectCaptures(captures(), reference(), ['fog', 'atlas'])).toThrow(
      'unknown scenarios named for publishing: atlas; available: armies, fog, map',
    );
  });
});

describe('parseNamedScenarios', () => {
  it.each<[string, string[] | 'all']>([
    ['No media notes here.', []],
    ['Publish scenarios: fog, map', ['fog', 'map']],
    ['publish SCENARIOS:fog map', ['fog', 'map']],
    ['Why\r\nPublish scenarios: `fog`,`map`\r\nmore', ['fog', 'map']],
    ['Publish scenarios: fog\nPublish scenarios: map, fog', ['fog', 'map']],
    ['Publish scenarios: fog\nPublish scenarios: all', 'all'],
    ['We will not publish scenarios: fog', []],
  ])('reads %j', (body, expected) => {
    expect(parseNamedScenarios(body)).toEqual(expected);
  });
});
