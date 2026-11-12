import { describe, expect, it } from 'vitest';
import { MAX_SCALE, minScale } from '../camera.ts';
import { DETAIL, detailAlpha } from './detail.ts';

const widest = minScale({ width: 1280, height: 720 }, { width: 7628.2, height: 4550 });

describe('the zoom rule', () => {
  it('shows the ground and the wide relief on the whole map, and no settlement, field, or movement', () => {
    expect(detailAlpha(DETAIL.ground, widest)).toBe(1);
    expect(detailAlpha(DETAIL.reliefWide, widest)).toBe(1);
    for (const band of [
      DETAIL.towns,
      DETAIL.villages,
      DETAIL.fields,
      DETAIL.life,
      DETAIL.townNames,
      DETAIL.peakNames,
    ]) {
      expect(detailAlpha(band, widest)).toBe(0);
    }
  });

  it('shows everything of the closest zoom at the closest zoom, and the coarser relief no longer', () => {
    for (const band of [
      DETAIL.reliefClose,
      DETAIL.villages,
      DETAIL.villageNames,
      DETAIL.fields,
      DETAIL.life,
    ]) {
      expect(detailAlpha(band, MAX_SCALE)).toBe(1);
    }
    expect(detailAlpha(DETAIL.reliefWide, MAX_SCALE)).toBe(0);
    expect(detailAlpha(DETAIL.reliefMiddle, MAX_SCALE)).toBe(0);
  });

  it('fades each thing in over a range of zoom instead of at one step', () => {
    for (const [name, band] of Object.entries(DETAIL)) {
      if (band.in[1] <= 0) continue;
      const middle = (band.in[0] + band.in[1]) / 2;
      const alpha = detailAlpha(band, middle);
      expect(alpha, name).toBeGreaterThan(0.05);
      expect(alpha, name).toBeLessThan(0.95);
    }
  });

  it('shows a town before a village, and a symbol before its name', () => {
    expect(DETAIL.towns.in[0]).toBeLessThan(DETAIL.villages.in[0]);
    expect(DETAIL.towns.in[1]).toBeLessThan(DETAIL.townNames.in[0]);
    expect(DETAIL.villages.in[1]).toBeLessThan(DETAIL.villageNames.in[0]);
  });

  it('keeps some relief strong at every zoom, also where the tiers hand over', () => {
    for (let scale = widest; scale <= MAX_SCALE; scale *= 1.05) {
      const strongest = Math.max(
        detailAlpha(DETAIL.reliefWide, scale),
        detailAlpha(DETAIL.reliefMiddle, scale),
        detailAlpha(DETAIL.reliefClose, scale),
      );
      expect(strongest, `at ${scale.toFixed(2)}`).toBeGreaterThan(0.65);
    }
  });
});
