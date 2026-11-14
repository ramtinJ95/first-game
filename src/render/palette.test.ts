import { expect, test } from 'vitest';
import { colourDistance, washTint } from './colour-distance.ts';
import { MINOR_COLOUR, POWER_COLOURS, washStrength, WASH_STRENGTH } from './palette.ts';
import { WASH_GROUNDS } from '../../scripts/map-colours.ts';
import { WASH_DESERT_GAIN } from './washes.ts';

test('atlas power washes differ from ground and every other power by at least ΔE76 10', () => {
  for (const [ground, colour] of Object.entries(WASH_GROUNDS)) {
    const strengths = washStrength(0.17);
    const washed = Object.entries(POWER_COLOURS).map(
      ([owner, tint]) =>
        [
          owner,
          washTint(
            colour,
            tint,
            strengths.greatPower * (ground === 'desert' ? WASH_DESERT_GAIN : 1),
          ),
        ] as const,
    );
    for (const [owner, tint] of washed) {
      expect(colourDistance(tint, colour), `${ground}: ${owner} vs ground`).toBeGreaterThanOrEqual(
        10,
      );
      for (const [other, otherTint] of washed)
        if (owner !== other) {
          expect(
            colourDistance(tint, otherTint),
            `${ground}: ${owner} vs ${other}`,
          ).toBeGreaterThanOrEqual(10);
        }
    }
  }
});

test('minor land keeps every ground colour unchanged throughout the atlas zoom band', () => {
  for (const scale of [0, 0.17, 0.4]) {
    const strength = washStrength(scale).minor;
    expect(strength).toBe(0);
    for (const [ground, colour] of Object.entries(WASH_GROUNDS)) {
      expect(
        washTint(colour, MINOR_COLOUR, strength * (ground === 'desert' ? WASH_DESERT_GAIN : 1)),
        `${ground} at ${scale} px/km`,
      ).toBe(colour);
    }
  }
});

test('close washes keep the original light strengths, with a monotonic atlas handover', () => {
  expect(washStrength(1)).toEqual(WASH_STRENGTH);
  expect(washStrength(4)).toEqual(WASH_STRENGTH);
  for (let s = 0.17; s < 1; s += 0.01) {
    expect(washStrength(s).greatPower).toBeGreaterThanOrEqual(washStrength(s + 0.01).greatPower);
    expect(washStrength(s).minor).toBeLessThanOrEqual(washStrength(s + 0.01).minor);
  }
});

test('Lab conversion has the reference black/white distance', () => {
  expect(colourDistance(0, 0xffffff)).toBeCloseTo(100, 3);
  expect(colourDistance(0xff0000, 0xff0000)).toBe(0);
});
