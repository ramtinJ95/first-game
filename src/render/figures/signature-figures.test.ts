import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { posedFigure, type FigureKind } from './motions.ts';
import { paintSvg } from './paint.ts';
import { artBounds } from './sheet.ts';

const RED = 0xb03a3a;

/** The figure at ease, painted at one pixel per figure unit, its feet on the bottom row. */
function raster(kind: FigureKind) {
  const { ops } = posedFigure(kind, 'stand', 0);
  const box = artBounds(ops);
  const width = Math.ceil(box.maxX - box.minX);
  const height = Math.ceil(-box.minY);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.minX} ${box.minY} ${width} ${height}">${paintSvg(ops, RED)}</svg>`;
  const image = new Resvg(svg).render();
  return { pixels: image.pixels, width: image.width, height: image.height };
}

function painted(kind: FigureKind) {
  const { pixels, width, height } = raster(kind);
  let area = 0;
  let iron = 0;
  let left = Infinity;
  let right = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ((pixels[i + 3] ?? 0) < 128) continue;
      area++;
      const [r, g, b] = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 14 && r > 80) iron++;
      if (y >= height - 12) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  return { area, ironShare: iron / area, ground: right - left };
}

describe('the great powers’ own figures', () => {
  it('draws war elephants as an elephant with its crew, far bigger than a horseman', () => {
    expect(painted('warElephants').area).toBeGreaterThan(1.6 * painted('heavyCavalry').area);
  });

  it('draws chariots as a car behind two horses, covering more ground than a horseman', () => {
    const chariot = painted('chariots');
    const horseman = painted('lightCavalry');
    expect(chariot.ground).toBeGreaterThan(1.5 * horseman.ground);
    expect(chariot.area).toBeGreaterThan(1.5 * horseman.area);
  });

  it('draws cataphracts with horse and rider both in iron', () => {
    expect(painted('cataphracts').ironShare).toBeGreaterThan(0.3);
    expect(painted('heavyCavalry').ironShare).toBeLessThan(0.15);
  });
});
