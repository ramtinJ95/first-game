import { Resvg } from '@resvg/resvg-js';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { changedPixels, screenshotChanged } from './compare.ts';
import { picture, texture } from './png-fixture.ts';

const font = createRequire(import.meta.url).resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');

function label(text: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#efe4c8"/><text x="8" y="26" font-family="DejaVu Sans" font-size="14" fill="#3b2a1a">${text}</text></svg>`;
  return Buffer.from(
    new Resvg(svg, { font: { fontFiles: [font], loadSystemFonts: false } }).render().asPng(),
  );
}

describe('screenshotChanged', () => {
  it('counts no changed pixels between identical pictures', () => {
    expect(changedPixels(picture(), picture())).toBe(0);
    expect(screenshotChanged(picture(), picture())).toBe(false);
  });

  it('notices one changed digit in a panel', () => {
    expect(screenshotChanged(label('Year 1, day 3'), label('Year 1, day 8'))).toBe(true);
  });

  it('notices a word changed for another of the same width', () => {
    expect(screenshotChanged(label('Gold: 1000'), label('Food: 1000'))).toBe(true);
  });

  it('notices a view moved by one pixel', () => {
    expect(
      screenshotChanged(
        picture(),
        picture((x, y) => texture(x - 1, y)),
      ),
    ).toBe(true);
  });

  it('counts a picture of another size as changed everywhere', () => {
    expect(changedPixels(picture(), picture(texture, 24))).toBe(48 * 48);
  });
});
