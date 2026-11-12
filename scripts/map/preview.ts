import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  TERRAIN_KINDS,
  type GameMap,
  type MapLine,
  type MultiPolygon,
  type Point,
  type StartingOwner,
  type TerrainKind,
} from '../../src/sim/map.ts';
import type { ManifestEntry } from '../capture/manifest.ts';

export const PREVIEW_DIR = resolve(import.meta.dirname, '../../captures/map');
const FONT_DIR = resolve(import.meta.dirname, '../../node_modules/dejavu-fonts-ttf/ttf');
const WIDTH_PX = 2400;

const OWNER_COLOURS: Record<StartingOwner, string> = {
  rome: '#c4553f',
  carthage: '#8c5bb0',
  macedon: '#3f7bc0',
  egypt: '#e0a91c',
  persia: '#3f9a5a',
  independent: '#efe5c9',
};

const SEA = '#a9c7d8';
const INK = '#1d1d1d';
const HALO = '#fffaf0';

const TERRAIN_STYLES: Record<TerrainKind, { fill: string; opacity: number; label: string }> = {
  mountains: { fill: '#6e4a2e', opacity: 0.5, label: 'Mountains' },
  hills: { fill: '#b08a5c', opacity: 0.4, label: 'Hills' },
  desert: { fill: '#f0d68c', opacity: 0.55, label: 'Desert' },
  forest: { fill: '#2f7a3a', opacity: 0.4, label: 'Forest' },
  lake: { fill: SEA, opacity: 1, label: 'Lake' },
};
/** Lakes go last so they cover the land tints. */
const TERRAIN_ORDER: readonly TerrainKind[] = ['desert', 'forest', 'hills', 'mountains', 'lake'];

const OWNER_LABELS: Record<StartingOwner, string> = {
  rome: 'Rome',
  carthage: 'Carthage',
  macedon: 'Macedon',
  egypt: 'Egypt',
  persia: 'Persia',
  independent: 'Independent',
};

export async function writePreview(map: GameMap, dir = PREVIEW_DIR): Promise<string> {
  const fontFiles = readdirSync(FONT_DIR)
    .filter((file) => /^DejaVuSans(-Bold)?\.ttf$/.test(file))
    .map((file) => join(FONT_DIR, file));
  const png = new Resvg(previewSvg(map), {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
  })
    .render()
    .asPng();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'map.png');
  writeFileSync(file, png);
  const manifest: ManifestEntry[] = [
    {
      file: 'map.png',
      title: `Province map with terrain, peaks, towns and villages (${map.provinces.length} provinces, ${map.settlements.length} settlements)`,
      kind: 'screenshot',
    },
  ];
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

interface Label {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  box: Box;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function previewSvg(map: GameMap): string {
  const scale = WIDTH_PX / map.width;
  const height = Math.ceil(map.height * scale);
  const px = ([x, y]: Point): Point => [x * scale, y * scale];
  const coords = (points: Point[]) =>
    points
      .map((point) =>
        px(point)
          .map((v) => v.toFixed(1))
          .join(' '),
      )
      .join('L');
  const area = (polygons: MultiPolygon) =>
    polygons.flatMap((polygon) => polygon.map((ring) => `M${coords(ring)}Z`)).join('');
  const lines = (polylines: MapLine[]) => polylines.map((line) => `M${coords(line)}`).join('');

  const cities = map.provinces.map((province) => ({ province, at: px(province.city) }));
  const order = [...cities].sort(
    (a, b) =>
      Number(b.province.capital) - Number(a.province.capital) || b.province.area - a.province.area,
  );
  const taken: Box[] = cities.map(({ at: [x, y] }) => ({
    left: x - 4,
    top: y - 4,
    right: x + 4,
    bottom: y + 4,
  }));
  const labels = order.map(({ province, at }) => {
    const label = placeLabel(province.name, at, province.capital, taken, {
      left: 0,
      top: 0,
      right: WIDTH_PX,
      bottom: height,
    });
    taken.push(label.box);
    return { province, label };
  });

  const circle = ([x, y]: Point, r: number, attrs: string) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" ${attrs}/>`;
  const triangle = ([x, y]: Point, size: number) =>
    `M${x.toFixed(1)} ${(y - size).toFixed(1)}L${(x + size).toFixed(1)} ${(y + size * 0.7).toFixed(1)}L${(x - size).toFixed(1)} ${(y + size * 0.7).toFixed(1)}Z`;
  const town = (at: Point) => circle(at, 2.4, `fill="${INK}" stroke="${HALO}" stroke-width="0.8"`);
  const village = (at: Point) =>
    circle(at, 1.5, `fill="${INK}" stroke="${HALO}" stroke-width="0.6"`);
  const capital = (at: Point) =>
    circle(at, 6.5, `fill="#fff" stroke="${INK}" stroke-width="2"`) +
    circle(at, 2.6, `fill="${INK}"`);
  const terrainSwatch = (kind: TerrainKind) =>
    `fill="${TERRAIN_STYLES[kind].fill}" fill-opacity="${TERRAIN_STYLES[kind].opacity}"`;

  const owners = Object.keys(OWNER_COLOURS) as StartingOwner[];
  const legend: { draw: (x: number, y: number) => string; label: string }[] = [
    ...owners.map((owner) => ({
      draw: (x: number, y: number) =>
        `<rect x="${x}" y="${y}" width="28" height="18" fill="${OWNER_COLOURS[owner]}" stroke="#5b4636"/>`,
      label: OWNER_LABELS[owner],
    })),
    { draw: (x: number, y: number) => capital([x + 14, y + 9]), label: 'Capital' },
    ...TERRAIN_KINDS.map((kind) => ({
      draw: (x: number, y: number) =>
        `<rect x="${x}" y="${y}" width="28" height="18" fill="${OWNER_COLOURS.independent}" stroke="#5b4636"/><rect x="${x}" y="${y}" width="28" height="18" ${terrainSwatch(kind)}/>`,
      label: TERRAIN_STYLES[kind].label,
    })),
    {
      draw: (x: number, y: number) => `<path d="${triangle([x + 14, y + 9], 6)}" fill="${INK}"/>`,
      label: 'Peak',
    },
    { draw: (x: number, y: number) => town([x + 14, y + 9]), label: 'Town' },
    { draw: (x: number, y: number) => village([x + 14, y + 9]), label: 'Village' },
  ];
  const legendTop = height - 40 - legend.length * 26;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH_PX}" height="${height}" viewBox="0 0 ${WIDTH_PX} ${height}" font-family="DejaVu Sans">`,
    `<rect width="${WIDTH_PX}" height="${height}" fill="#d9d6cf"/>`,
    `<path d="${area([[map.extent]])}" fill="${SEA}"/>`,
    ...map.provinces.map(
      (province) =>
        `<path d="${area(province.outline)}" fill="${OWNER_COLOURS[province.owner]}" fill-rule="evenodd"/>`,
    ),
    ...TERRAIN_ORDER.map((kind) => {
      const outlines = map.terrain.filter((terrain) => terrain.kind === kind);
      return `<path d="${outlines.map((terrain) => area(terrain.outline)).join('')}" ${terrainSwatch(kind)} fill-rule="evenodd"/>`;
    }),
    `<path d="${map.provinces.map((province) => area(province.outline)).join('')}" fill="none" stroke="#5b4636" stroke-width="0.9" stroke-linejoin="round" stroke-opacity="0.85"/>`,
    `<path d="${lines(map.rivers.map((river) => river.line))}" fill="none" stroke="#3f7fb6" stroke-width="1.1" stroke-linejoin="round"/>`,
    `<path d="${lines(map.coastline)}" fill="none" stroke="#24435c" stroke-width="1.2" stroke-linejoin="round"/>`,
    `<path d="${area([[map.extent]])}" fill="none" stroke="#6b6b6b" stroke-width="1.5"/>`,
    `<path d="${map.peaks.map((peak) => triangle(px(peak.at), 3.5)).join('')}" fill="${INK}" stroke="${HALO}" stroke-width="0.6"/>`,
    ...map.settlements.map((settlement) =>
      settlement.rank === 'town' ? town(px(settlement.at)) : village(px(settlement.at)),
    ),
    ...cities.map(({ province, at }) =>
      province.capital ? capital(at) : circle(at, 3, `fill="${INK}"`),
    ),
    ...labels.map(({ province, label }) => {
      const attrs = `x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="${label.anchor}" font-size="${province.capital ? 17 : 14}" font-weight="${province.capital ? 'bold' : 'normal'}"`;
      const text = escape(province.name);
      return `<text ${attrs} fill="none" stroke="${HALO}" stroke-width="3.5" stroke-linejoin="round" stroke-opacity="0.9">${text}</text><text ${attrs} fill="${INK}">${text}</text>`;
    }),
    `<rect x="24" y="${legendTop - 44}" width="250" height="${legend.length * 26 + 64}" rx="6" fill="${HALO}" fill-opacity="0.92" stroke="#6b6b6b"/>`,
    `<text x="40" y="${legendTop - 16}" font-size="18" font-weight="bold" fill="${INK}">Legend</text>`,
    ...legend.map(({ draw, label }, i) => {
      const y = legendTop + i * 26;
      return `${draw(40, y)}<text x="80" y="${y + 15}" font-size="16" fill="${INK}">${label}</text>`;
    }),
    '</svg>',
  ].join('\n');
}

function placeLabel(
  name: string,
  [x, y]: Point,
  capital: boolean,
  taken: Box[],
  frame: Box,
): Label {
  const size = capital ? 17 : 14;
  const width = name.length * size * (capital ? 0.66 : 0.6);
  const gap = capital ? 9 : 6;
  const candidates: [dx: number, dy: number, anchor: Label['anchor']][] = [
    [gap, size * 0.35, 'start'],
    [-gap, size * 0.35, 'end'],
    [0, -gap - 2, 'middle'],
    [0, gap + size, 'middle'],
    [gap, -gap, 'start'],
    [gap, gap + size * 0.7, 'start'],
    [-gap, -gap, 'end'],
    [-gap, gap + size * 0.7, 'end'],
  ];
  const labels = candidates.map(([dx, dy, anchor]): Label => {
    const left = anchor === 'start' ? x + dx : anchor === 'end' ? x + dx - width : x - width / 2;
    const baseline = y + dy;
    return {
      x: x + dx,
      y: baseline,
      anchor,
      box: { left, top: baseline - size, right: left + width, bottom: baseline + size * 0.25 },
    };
  });
  const inFrame = labels.filter(({ box }) => box.left >= frame.left && box.right <= frame.right);
  const free = inFrame.find((label) => !taken.some((box) => overlaps(box, label.box)));
  return free ?? inFrame[0] ?? (labels[0] as Label);
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
