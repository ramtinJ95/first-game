import { expect, test } from 'vitest';
import { NAME_CONTRAST_FLOOR, NAME_GROUNDS } from '../../../scripts/village-contrast.ts';
import { contrastRatio } from '../colour-distance.ts';
import { INK } from '../palette.ts';
import { SETTLEMENT_NAME } from './places.ts';

test('village names meet 7:1 against their opaque backing on every ground', () => {
  for (const [ground, colour] of Object.entries(NAME_GROUNDS)) {
    expect(Number.isFinite(contrastRatio(SETTLEMENT_NAME.fill, colour)), ground).toBe(true);
    expect(
      contrastRatio(SETTLEMENT_NAME.fill, SETTLEMENT_NAME.stroke.color),
      ground,
    ).toBeGreaterThanOrEqual(NAME_CONTRAST_FLOOR);
  }
  expect(SETTLEMENT_NAME.fill).toBe(INK);
  expect(SETTLEMENT_NAME.fontWeight).toBe('600');
  expect(SETTLEMENT_NAME.stroke.width).toBe(3);
});

test('contrast has the black/white and identical-colour reference values', () => {
  expect(contrastRatio(0, 0xffffff)).toBe(21);
  expect(contrastRatio(0x123456, 0x123456)).toBe(1);
});
