import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateRegistries } from './registries.ts';

const scripts = new URL('./', import.meta.url);
const available = readdirSync(new URL('sim/', scripts))
  .filter((file) => /^[a-z][a-z0-9-]*\.ts$/.test(file))
  .map((file) => file.slice(0, -3))
  .sort();
const [name, ...args] = process.argv.slice(2);
if (name === '--help') {
  console.log(`Choose a simulation: ${available.join(', ')}`);
} else if (!name || !available.includes(name)) {
  console.error(`Choose a simulation: ${available.join(', ')}`);
  process.exitCode = 1;
} else {
  generateRegistries();
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(`sim/${name}.ts`, scripts)), ...args],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
