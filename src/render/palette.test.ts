import { expect, test } from 'vitest';
import { colourDistance, washTint } from './colour-distance.ts';
import { MINOR_COLOUR, POWER_COLOURS, washStrength, WASH_STRENGTH } from './palette.ts';
import { WASH_GROUNDS } from '../../scripts/map-colours.ts';
import { WASH_DESERT_GAIN } from './washes.ts';

const colours = { ...POWER_COLOURS, minors: MINOR_COLOUR };

test('atlas washes differ from bare ground and every other owner by at least ΔE76 10', () => {
  for (const [ground, colour] of Object.entries(WASH_GROUNDS)) {
    const strengths = washStrength(0.17);
    const washed = Object.entries(colours).map(
      ([owner, tint]) =>
        [
          owner,
          washTint(
            colour,
            tint,
            (owner === 'minors' ? strengths.minor : strengths.greatPower) *
              (ground === 'desert' ? WASH_DESERT_GAIN : 1),
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

test('close washes keep the original light strengths, with a monotonic atlas handover', () => {
  expect(washStrength(1)).toEqual(WASH_STRENGTH);
  expect(washStrength(4)).toEqual(WASH_STRENGTH);
  for (let s = 0.17; s < 1; s += 0.01) {
    expect(washStrength(s).greatPower).toBeGreaterThanOrEqual(washStrength(s + 0.01).greatPower);
  }
});

test('Lab conversion has the reference black/white distance', () => {
  expect(colourDistance(0, 0xffffff)).toBeCloseTo(100, 3);
  expect(colourDistance(0xff0000, 0xff0000)).toBe(0);
});
