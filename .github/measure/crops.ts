import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

// usage: node crops.ts <current> <reference> <result.tsv> <out-dir>; crops shots whose r3s8 count is in (24, 5000]
const [current, reference, tsv, out] = process.argv.slice(2) as [string, string, string, string];
mkdirSync(out, { recursive: true });
const rows = readFileSync(tsv, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
const header = readFileSync(tsv, 'utf8').split('\n')[0]!.split('\t');
const col = header.indexOf('r3s8');
const picked = rows.map((r) => r.split('\t')).filter((c) => Number(c[col]) > 24 && Number(c[col]) <= 5000).slice(0, 14);
const R = 3, SL = 8;
function inside(p: PNG, q: PNG, i: number) {
  const x = i % q.width, y = (i - x) / q.width;
  for (let c = 0; c < 3; c++) {
    const v = p.data[i * 4 + c]!;
    if (Math.abs(v - q.data[i * 4 + c]!) <= SL) continue;
    let lo = 255, hi = 0;
    for (let ny = Math.max(0, y - R); ny <= Math.min(q.height - 1, y + R); ny++)
      for (let nx = Math.max(0, x - R); nx <= Math.min(q.width - 1, x + R); nx++) {
        const s = q.data[(ny * q.width + nx) * 4 + c]!; if (s < lo) lo = s; if (s > hi) hi = s; }
    if (v < lo - SL || v > hi + SL) return false;
  }
  return true;
}
for (const [file] of picked) {
  const a = PNG.sync.read(readFileSync(join(current, file!)));
  const b = PNG.sync.read(readFileSync(join(reference, file!)));
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const pts: number[] = [];
  for (let i = 0; i < a.width * a.height; i++) if (!inside(a, b, i) || !inside(b, a, i)) {
    const x = i % a.width, y = (i - x) / a.width; pts.push(x, y); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // crop 180x120 around the densest changed point (the median one)
  const mid = Math.floor(pts.length / 4) * 2;
  const cx = Math.min(Math.max(0, pts[mid]! - 60), a.width - 120), cy = Math.min(Math.max(0, pts[mid + 1]! - 40), a.height - 80);
  const parts = [0, 1, 2].map(() => new PNG({ width: 120, height: 80 }));
  for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
    const s = ((cy + y) * a.width + cx + x) * 4;
    const ok = inside(a, b, (cy + y) * a.width + cx + x) && inside(b, a, (cy + y) * a.width + cx + x);
    const t = (y * 120 + x) * 4;
    for (let c = 0; c < 4; c++) { parts[0]!.data[t + c] = a.data[s + c]!; parts[1]!.data[t + c] = b.data[s + c]!; }
    parts[2]!.data[t] = ok ? a.data[s]! >> 2 : 255; parts[2]!.data[t + 1] = ok ? a.data[s + 1]! >> 2 : 0; parts[2]!.data[t + 2] = ok ? a.data[s + 2]! >> 2 : 0; parts[2]!.data[t + 3] = 255;
  }
  const name = file!.replaceAll('/', '__');
  for (const [i, part] of parts.entries()) {
    writeFileSync(join(out, `${name}.${i}.png`), PNG.sync.write(part));
    writeFileSync(join(out, `${name}.${i}.png.txt`), `${['current', 'reference', 'mask'][i]} ${file} crop=${cx},${cy}`);
  }
  writeFileSync(join(out, name + '.txt'), `${file} bbox=${x0},${y0},${x1},${y1} changed=${pts.length / 2} crop=${cx},${cy}`);
}
