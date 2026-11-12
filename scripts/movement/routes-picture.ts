import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { ManifestEntry } from '../capture/manifest.ts';
import { previewSvg } from '../map/preview.ts';
import type { MapPoint } from '../../src/sim/state/map-point.ts';
import { findPath } from '../../src/sim/world/find-path.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import { cityAt, loadMap } from './experiment.ts';

const OUT_DIR = resolve(import.meta.dirname, '../../captures/movement');
const FONT_DIR = resolve(import.meta.dirname, '../../node_modules/dejavu-fonts-ttf/ttf');

const LAND_ROUTES: [string, string][] = [
  ['roma', 'tarraco'],
  ['olisipo', 'persepolis'],
  ['tingis', 'alexandria'],
  ['lutetia', 'memphis'],
];
const SEA_ROUTES: [string, string][] = [['carthago', 'syracusae']];

const map = loadMap();
const world = buildWorld(map);
const base = previewSvg(map);
const width = Number(/width="(\d+)"/.exec(base)?.[1]);
const scale = width / map.width;

const line = (points: MapPoint[]) =>
  points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * scale).toFixed(1)} ${(p.y * scale).toFixed(1)}`)
    .join('');

const overlay: string[] = [];
for (const [a, b] of LAND_ROUTES) {
  const from = cityAt(map, a);
  const path = findPath(world.mesh, from, cityAt(map, b), 'land');
  if (!path) throw new Error(`no land path ${a}-${b}`);
  const d = line([from, ...path]);
  overlay.push(
    `<path d="${d}" fill="none" stroke="#fffaf0" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<path d="${d}" fill="none" stroke="#b3122e" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  );
}
for (const [a, b] of SEA_ROUTES) {
  const from = world.harbours.get(a as never);
  const to = world.harbours.get(b as never);
  const path = from && to && findPath(world.mesh, from, to, 'sea');
  if (!from || !path) throw new Error(`no sea path ${a}-${b}`);
  overlay.push(
    `<path d="${line([from, ...path])}" fill="none" stroke="#0b3d91" stroke-width="3.5" stroke-dasharray="10 6" stroke-linecap="round"/>`,
  );
}
overlay.push(
  `<rect x="24" y="24" width="430" height="92" rx="6" fill="#fffaf0" fill-opacity="0.92" stroke="#6b6b6b"/>`,
  `<path d="M40 56L100 56" stroke="#b3122e" stroke-width="3.5"/><text x="112" y="62" font-size="18" fill="#1d1d1d">March on land</text>`,
  `<path d="M40 92L100 92" stroke="#0b3d91" stroke-width="3.5" stroke-dasharray="10 6"/><text x="112" y="98" font-size="18" fill="#1d1d1d">Convoy at sea</text>`,
);

const svg = base.replace('</svg>', `${overlay.join('\n')}\n</svg>`);
const fontFiles = readdirSync(FONT_DIR)
  .filter((file) => /^DejaVuSans(-Bold)?\.ttf$/.test(file))
  .map((file) => join(FONT_DIR, file));
const png = new Resvg(svg, {
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
})
  .render()
  .asPng();
mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, 'routes.png');
writeFileSync(file, png);
const manifest: ManifestEntry[] = [
  {
    file: 'routes.png',
    title: 'Four land marches and one convoy crossing, found on the committed map',
    kind: 'screenshot',
  },
];
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${relative(process.cwd(), file)}`);
