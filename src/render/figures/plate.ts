import { MOTIONS, MOUNTED, posedFigure, type FigureKind, type Motion } from './motions.ts';
import { n, paintSvg } from './paint.ts';
import { shipArt } from './things.ts';

const TITLES: Partial<Record<FigureKind, string>> = {
  spearmen: 'Spearmen',
  swordsmen: 'Swordsmen',
  skirmishers: 'Skirmishers',
  archers: 'Archers',
  lightCavalry: 'Light cavalry',
  heavyCavalry: 'Heavy cavalry',
  general: 'General',
};

/** The frame of each motion that the plate shows, where the movement reads best. */
const SHOWN: Record<Motion, number> = { stand: 0, march: 0.25, fight: 0.5, run: 0.34, fall: 1 };

/**
 * A plate of every troop, the general, and a ship, in each of `rows` motions, in two
 * faction colours, drawn as one SVG at `width` by `height`.
 */
export function plateSvg(
  colours: readonly [number, number],
  rows: readonly Motion[] = ['stand', 'march', 'fight'],
  width = 1280,
  height = 720,
): string {
  const kinds = Object.keys(TITLES) as FigureKind[];
  const columns = kinds.length + 1;
  const left = 86;
  const top = 40;
  const columnWidth = (width - left - 10) / columns;
  const rowHeight = (height - top - 10) / (rows.length * 2);
  const paper = '#ecdfbf';
  let body = `<rect width="${width}" height="${height}" fill="${paper}"/>`;
  const text = (
    x: number,
    y: number,
    words: string,
    size: number,
    anchor = 'middle',
    style = 'italic',
  ) =>
    `<text x="${n(x)}" y="${n(y)}" font-family="Palatino Linotype, Palatino, Book Antiqua, Georgia, serif" font-size="${size}" font-style="${style}" fill="#3b2816" text-anchor="${anchor}">${words}</text>`;
  kinds.forEach((kind, i) => {
    body += text(left + (i + 0.5) * columnWidth, 26, TITLES[kind] ?? kind, 15);
  });
  body += text(left + (kinds.length + 0.5) * columnWidth, 26, 'Transport', 15);
  const motionNames: Record<Motion, string> = {
    stand: 'at ease',
    march: 'marching',
    fight: 'fighting',
    run: 'broken',
    fall: 'fallen',
  };
  colours.forEach((colour, band) => {
    rows.forEach((row, r) => {
      const y = top + (band * rows.length + r + 1) * rowHeight - 14;
      body += `<line x1="${left - 6}" x2="${width - 10}" y1="${n(y + 2)}" y2="${n(y + 2)}" stroke="#a38b66" stroke-width="0.8"/>`;
      body += text(12, y - rowHeight * 0.4, motionNames[row], 14, 'start');
      kinds.forEach((kind, i) => {
        const motion: Motion = row;
        const frames = MOTIONS[motion].frames;
        const t = MOTIONS[motion].loop ? Math.round(SHOWN[row] * frames) / frames : SHOWN[row];
        const { ops, turn } = posedFigure(kind, motion, t);
        const s = MOUNTED.has(kind) ? 0.74 : 0.92;
        const x = left + (i + 0.42) * columnWidth;
        body += `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(turn)}) scale(${s})">${paintSvg(ops, colour)}</g>`;
      });
      if (row === 'fall') return;
      const x = left + (kinds.length + 0.5) * columnWidth;
      const ship = shipArt(
        row === 'stand' ? 0.1 : row === 'march' ? 0.1 : 0.3,
        row === 'stand' ? 0 : 1,
      );
      body += `<g transform="translate(${n(x)} ${n(y - 6)}) scale(0.5)">${paintSvg(ship, colour)}</g>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/**
 * Every frame of the horses' walk and gallop side by side, so the two gaits can be
 * told apart: the walk keeps three hooves down, the gallop gathers and flies.
 */
export function gaitSvg(colour: number, width = 1280, height = 720): string {
  const rows = [
    ['heavyCavalry', 'march', 'heavy horse, walk'],
    ['heavyCavalry', 'run', 'heavy horse, gallop'],
    ['lightCavalry', 'march', 'light horse, walk'],
    ['lightCavalry', 'run', 'light horse, gallop'],
  ] as const;
  const rowHeight = (height - 20) / rows.length;
  let body = `<rect width="${width}" height="${height}" fill="#ecdfbf"/>`;
  rows.forEach(([kind, motion, title], r) => {
    const y = 10 + (r + 1) * rowHeight - 16;
    body += `<line x1="150" x2="${width - 10}" y1="${n(y + 2)}" y2="${n(y + 2)}" stroke="#a38b66" stroke-width="0.8"/>`;
    body += `<text x="12" y="${n(y - rowHeight * 0.35)}" font-family="Palatino Linotype, Palatino, Book Antiqua, Georgia, serif" font-size="15" font-style="italic" fill="#3b2816">${title}</text>`;
    const frames = MOTIONS[motion].frames;
    for (let f = 0; f < frames; f++) {
      const { ops } = posedFigure(kind, motion, f / frames);
      body += `<g transform="translate(${n(200 + f * 135)} ${n(y)}) scale(0.95)">${paintSvg(ops, colour)}</g>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
