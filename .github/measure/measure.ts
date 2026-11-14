import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { changedPixels } from '../../scripts/capture/compare.ts';

// usage: node measure.ts <current-dir> <reference-dir> <settings like 3:8,0:0>
const [current, reference, settingsArg] = process.argv.slice(2) as [string, string, string];
const settings = settingsArg.split(',').map((s) => s.split(':').map(Number) as [number, number]);
const lines: string[] = [`# file\tbytes\t${settings.map(([r, s]) => `r${r}s${s}`).join('\t')}`];
for (const scenario of readdirSync(current).sort()) {
  const dir = join(current, scenario);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!/\.(png|gif)$/.test(file)) continue;
    const bytes = statSync(join(dir, file)).size;
    const ref = join(reference, scenario, file);
    if (file.endsWith('.gif')) { lines.push(`${scenario}/${file}\t${bytes}\tclip`); continue; }
    if (!existsSync(join(reference, scenario, 'manifest.json'))) { lines.push(`${scenario}/${file}\t${bytes}\tnew-scenario`); continue; }
    if (!existsSync(ref)) { lines.push(`${scenario}/${file}\t${bytes}\tnew-file`); continue; }
    const a = readFileSync(join(dir, file)), b = readFileSync(ref);
    lines.push(`${scenario}/${file}\t${bytes}\t${settings.map(([r, s]) => changedPixels(a, b, r, s)).join('\t')}`);
  }
}
console.log(lines.join('\n'));
