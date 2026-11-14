import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateRegistries } from './registries.ts';

describe('file-based registries', () => {
  let root: string;
  let url: URL;
  const write = (file: string, data: unknown) =>
    writeFileSync(join(root, file), JSON.stringify(data));
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'game-registries-'));
    url = pathToFileURL(root + '/');
    for (const directory of [
      'src/sim/save-changes',
      'src/app/alert-kinds',
      'src/sim/orders/registrations',
    ]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    write('src/sim/save-changes/base.json', { adds: 'The base state.' });
    write('src/app/alert-kinds/base.json', ['battleBegan', 'battleEnded']);
    writeFileSync(join(root, 'src/sim/orders/registrations/base.ts'), '');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('discovers additions by filename, sorts them, and does not rewrite unchanged output', () => {
    write('src/sim/save-changes/zeal.json', { adds: 'Zeal.' });
    write('src/sim/save-changes/armies.json', { adds: 'Armies.' });
    write('src/app/alert-kinds/zeal.json', ['zealChanged']);
    writeFileSync(join(root, 'src/sim/orders/registrations/zeal.ts'), '');
    generateRegistries(url);
    expect(
      JSON.parse(readFileSync(join(root, 'src/sim/save-changes.generated.json'), 'utf8')),
    ).toEqual([
      { name: 'armies', adds: 'Armies.' },
      { name: 'base', adds: 'The base state.' },
      { name: 'zeal', adds: 'Zeal.' },
    ]);
    expect(readFileSync(join(root, 'src/app/alert-kinds.generated.ts'), 'utf8')).toContain(
      "'zealChanged'",
    );
    expect(readFileSync(join(root, 'src/sim/orders/registry.generated.ts'), 'utf8')).toContain(
      "'./registrations/zeal.ts'",
    );
    const target = join(root, 'src/sim/save-changes.generated.json');
    const changed = statSync(target).mtimeMs;
    generateRegistries(url);
    expect(statSync(target).mtimeMs).toBe(changed);
  });

  it('rejects duplicate alert kinds rather than silently accepting overlapping registrations', () => {
    write('src/app/alert-kinds/duplicate.json', ['battleBegan']);
    expect(() => generateRegistries(url)).toThrow('alert kinds must be nonempty and unique');
  });

  it.each([{}, { adds: '' }, { adds: 13 }])(
    'requires each save change to describe its addition: %j',
    (data) => {
      write('src/sim/save-changes/bad.json', data);
      expect(() => generateRegistries(url)).toThrow('bad.json must describe what it adds');
    },
  );

  it('rejects malformed alert names and change filenames', () => {
    write('src/app/alert-kinds/bad.json', ['bad-name']);
    expect(() => generateRegistries(url)).toThrow(
      'bad.json must contain nonempty alert-kind names',
    );
    write('src/sim/save-changes/Bad Name.json', { adds: 'Invalid.' });
    expect(() => generateRegistries(url)).toThrow('invalid save change filename');
  });

  it('does not silently generate an empty save format', () => {
    rmSync(join(root, 'src/sim/save-changes/base.json'));
    expect(() => generateRegistries(url)).toThrow('at least one change');
  });
});
