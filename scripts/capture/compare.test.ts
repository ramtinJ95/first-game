import { describe, expect, it } from 'vitest';
import { changedPixels, screenshotChanged } from './compare.ts';
import { picture, texture } from './png-fixture.ts';

describe('screenshotChanged', () => {
  const field = picture();

  it('counts no changed pixels between identical pictures', () => {
    expect(changedPixels(field, picture())).toBe(0);
    expect(screenshotChanged(field, picture())).toBe(false);
  });

  it('ignores a shift of 2 px within a textured field', () => {
    const shifted = picture((x, y) => texture(x - 2, y));
    expect(screenshotChanged(field, shifted)).toBe(false);
  });

  it('notices a 10x10 block recoloured by 40', () => {
    const recoloured = picture((x, y) =>
      x >= 20 && x < 30 && y >= 20 && y < 30 ? texture(x, y) + 40 : texture(x, y),
    );
    expect(screenshotChanged(field, recoloured)).toBe(true);
  });
});
