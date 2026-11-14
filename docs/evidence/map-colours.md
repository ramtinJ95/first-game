# Atlas ownership contrast

CIE76 ΔE, D65 Lab converted from sRGB. Each cell is **before → after**; dash is self-comparison. Floor: **10** between every pair of powers and between each power and each ground swatch. Minors have no atlas wash: their difference from ground is deliberately **0**, not subject to the floor. Power/minor contrast is therefore the power/ground contrast; boundary ink separates neighbouring minors. Regenerate with `node scripts/map-colours.ts`.

These are full-strength wash interiors at atlas scale (0.17 px/km), using the actual normal-alpha composition and desert gain. The owner chose unwashed minors after reviewing the first PR captures: sand stays sand and forest stays forest across the predominantly minor-held opening map. Minors remain unwashed through 0.4 px/km; the original light 0.34/0.14 power/minor strengths return by 0.9 px/km. Border fades necessarily reach zero; owner-coloured boundary ink carries those edges, and a cream halo/double-weight stroke identifies the player first. Relief ink and opaque drawing highlights are not ownership pixels. The mountain row is the representative shaded-ground swatch, not a claim that opaque ink is tinted.

## bare

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 24.0 → 43.1 | —           | 24.6 → 45.8 | 33.4 → 60.6 | 22.0 → 25.3 | 27.8 → 50.2 | 21.3 → 43.1 |
| carthage | 30.4 → 55.5 | 24.6 → 45.8 | —           | 11.1 → 17.9 | 40.1 → 65.8 | 32.2 → 59.1 | 27.8 → 55.5 |
| macedon  | 33.3 → 61.1 | 33.4 → 60.6 | 11.1 → 17.9 | —           | 44.9 → 77.4 | 31.9 → 60.1 | 30.7 → 61.1 |
| egypt    | 17.8 → 37.2 | 22.0 → 25.3 | 40.1 → 65.8 | 44.9 → 77.4 | —           | 20.8 → 43.4 | 16.9 → 37.2 |
| persia   | 17.9 → 31.9 | 27.8 → 50.2 | 32.2 → 59.1 | 31.9 → 60.1 | 20.8 → 43.4 | —           | 14.7 → 31.9 |
| minors   | 4.3 → 0.0   | 21.3 → 43.1 | 27.8 → 55.5 | 30.7 → 61.1 | 16.9 → 37.2 | 14.7 → 31.9 | —           |

## desert

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 26.6 → 46.7 | —           | 29.8 → 55.2 | 40.7 → 72.3 | 24.4 → 27.4 | 33.5 → 59.0 | 24.2 → 46.7 |
| carthage | 39.3 → 71.1 | 29.8 → 55.2 | —           | 13.8 → 20.7 | 46.0 → 75.9 | 37.4 → 68.2 | 34.8 → 71.1 |
| macedon  | 43.9 → 79.2 | 40.7 → 72.3 | 13.8 → 20.7 | —           | 52.1 → 89.4 | 36.7 → 69.2 | 39.1 → 79.2 |
| egypt    | 14.2 → 33.9 | 24.4 → 27.4 | 46.0 → 75.9 | 52.1 → 89.4 | —           | 25.2 → 51.0 | 15.5 → 33.9 |
| persia   | 21.7 → 38.0 | 33.5 → 59.0 | 37.4 → 68.2 | 36.7 → 69.2 | 25.2 → 51.0 | —           | 17.5 → 38.0 |
| minors   | 5.6 → 0.0   | 24.2 → 46.7 | 34.8 → 71.1 | 39.1 → 79.2 | 15.5 → 33.9 | 17.5 → 38.0 | —           |

## steppe

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 21.6 → 38.5 | —           | 25.6 → 47.8 | 35.5 → 63.0 | 21.3 → 24.1 | 28.3 → 51.5 | 20.3 → 38.5 |
| carthage | 32.4 → 58.4 | 25.6 → 47.8 | —           | 12.4 → 18.5 | 40.5 → 66.0 | 32.2 → 59.5 | 29.5 → 58.4 |
| macedon  | 36.7 → 65.5 | 35.5 → 63.0 | 12.4 → 18.5 | —           | 46.2 → 78.0 | 32.0 → 60.3 | 33.5 → 65.5 |
| egypt    | 12.8 → 28.6 | 21.3 → 24.1 | 40.5 → 66.0 | 46.2 → 78.0 | —           | 22.1 → 44.4 | 14.3 → 28.6 |
| persia   | 16.6 → 29.6 | 28.3 → 51.5 | 32.2 → 59.5 | 32.0 → 60.3 | 22.1 → 44.4 | —           | 13.8 → 29.6 |
| minors   | 3.8 → 0.0   | 20.3 → 38.5 | 29.5 → 58.4 | 33.5 → 65.5 | 14.3 → 28.6 | 13.8 → 29.6 | —           |

## arid

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 19.1 → 33.6 | —           | 26.1 → 48.7 | 36.3 → 64.3 | 21.9 → 23.8 | 29.5 → 52.2 | 18.8 → 33.6 |
| carthage | 30.8 → 56.1 | 26.1 → 48.7 | —           | 12.5 → 18.9 | 40.8 → 66.5 | 32.4 → 59.8 | 28.2 → 56.1 |
| macedon  | 36.1 → 64.7 | 36.3 → 64.3 | 12.5 → 18.9 | —           | 46.8 → 79.1 | 32.3 → 60.8 | 33.0 → 64.7 |
| egypt    | 12.1 → 24.9 | 21.9 → 23.8 | 40.8 → 66.5 | 46.8 → 79.1 | —           | 22.7 → 45.3 | 14.5 → 24.9 |
| persia   | 17.3 → 30.2 | 29.5 → 52.2 | 32.4 → 59.8 | 32.3 → 60.8 | 22.7 → 45.3 | —           | 14.9 → 30.2 |
| minors   | 3.4 → 0.0   | 18.8 → 33.6 | 28.2 → 56.1 | 33.0 → 64.7 | 14.5 → 24.9 | 14.9 → 30.2 | —           |

## farmland

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 24.6 → 43.9 | —           | 25.0 → 46.9 | 34.0 → 61.8 | 22.5 → 25.0 | 28.5 → 51.1 | 22.0 → 43.9 |
| carthage | 33.1 → 60.1 | 25.0 → 46.9 | —           | 11.4 → 18.0 | 40.9 → 66.1 | 32.9 → 59.9 | 29.7 → 60.1 |
| macedon  | 35.4 → 65.1 | 34.0 → 61.8 | 11.4 → 18.0 | —           | 45.8 → 77.8 | 32.5 → 61.0 | 32.2 → 65.1 |
| egypt    | 14.4 → 33.2 | 22.5 → 25.0 | 40.9 → 66.1 | 45.8 → 77.8 | —           | 21.4 → 43.7 | 15.5 → 33.2 |
| persia   | 12.8 → 22.5 | 28.5 → 51.1 | 32.9 → 59.9 | 32.5 → 61.0 | 21.4 → 43.7 | —           | 11.6 → 22.5 |
| minors   | 3.7 → 0.0   | 22.0 → 43.9 | 29.7 → 60.1 | 32.2 → 65.1 | 15.5 → 33.2 | 11.6 → 22.5 | —           |

## forest

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 23.3 → 42.7 | —           | 25.0 → 46.9 | 33.7 → 61.1 | 21.4 → 25.5 | 27.4 → 51.0 | 20.7 → 42.7 |
| carthage | 31.3 → 57.2 | 25.0 → 46.9 | —           | 11.2 → 17.9 | 40.5 → 66.6 | 32.7 → 60.8 | 28.4 → 57.2 |
| macedon  | 33.9 → 61.3 | 33.7 → 61.1 | 11.2 → 17.9 | —           | 45.3 → 77.2 | 32.4 → 60.7 | 31.2 → 61.3 |
| egypt    | 15.9 → 34.5 | 21.4 → 25.5 | 40.5 → 66.6 | 45.3 → 77.2 | —           | 21.0 → 43.1 | 16.2 → 34.5 |
| persia   | 14.9 → 26.4 | 27.4 → 51.0 | 32.7 → 60.8 | 32.4 → 60.7 | 21.0 → 43.1 | —           | 13.0 → 26.4 |
| minors   | 3.8 → 0.0   | 20.7 → 42.7 | 28.4 → 57.2 | 31.2 → 61.3 | 16.2 → 34.5 | 13.0 → 26.4 | —           |

## mountain

| Owner    | Ground      | rome        | carthage    | macedon     | egypt       | persia      | minors      |
| -------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| rome     | 19.2 → 34.4 | —           | 26.1 → 48.7 | 35.7 → 63.1 | 22.1 → 25.2 | 28.8 → 51.9 | 18.9 → 34.4 |
| carthage | 27.6 → 50.3 | 26.1 → 48.7 | —           | 11.6 → 17.9 | 41.7 → 68.0 | 32.9 → 61.2 | 26.8 → 50.3 |
| macedon  | 32.1 → 56.3 | 35.7 → 63.1 | 11.6 → 17.9 | —           | 47.7 → 79.1 | 33.5 → 61.6 | 31.2 → 56.3 |
| egypt    | 16.4 → 30.6 | 22.1 → 25.2 | 41.7 → 68.0 | 47.7 → 79.1 | —           | 22.5 → 44.7 | 17.1 → 30.6 |
| persia   | 13.8 → 24.5 | 28.8 → 51.9 | 32.9 → 61.2 | 33.5 → 61.6 | 22.5 → 44.7 | —           | 13.0 → 24.5 |
| minors   | 1.4 → 0.0   | 18.9 → 34.4 | 26.8 → 50.3 | 31.2 → 56.3 | 17.1 → 30.6 | 13.0 → 24.5 | —           |
