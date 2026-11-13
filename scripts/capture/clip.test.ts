import { describe, expect, it } from 'vitest';
import { clipFrame, type ClipPage } from './clip.ts';

function page(options: { drawn: boolean; shot: () => Promise<Buffer> }): ClipPage {
  return {
    waitForFunction: (async () => {
      if (!options.drawn) throw new Error('Timeout exceeded');
      return undefined;
    }) as unknown as ClipPage['waitForFunction'],
    screenshot: (async () => options.shot()) as unknown as ClipPage['screenshot'],
  };
}

describe('clipFrame', () => {
  it('takes the frame once the map has drawn', async () => {
    const png = Buffer.from('png');
    expect(await clipFrame(page({ drawn: true, shot: async () => png }))).toBe(png);
  });

  it('skips the frame, without throwing, while no map has drawn', async () => {
    let asked = false;
    const frame = await clipFrame(
      page({
        drawn: false,
        shot: async () => {
          asked = true;
          return Buffer.from('png');
        },
      }),
    );
    expect(frame).toBeUndefined();
    expect(asked).toBe(false);
  });

  it('skips the frame, without throwing, when the screenshot times out', async () => {
    const frame = await clipFrame(
      page({
        drawn: true,
        shot: async () => {
          throw new Error('page.screenshot: Timeout 5000ms exceeded.');
        },
      }),
    );
    expect(frame).toBeUndefined();
  });
});
