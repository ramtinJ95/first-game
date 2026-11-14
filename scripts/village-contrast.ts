import { contrastRatio, washTint } from '../src/render/colour-distance.ts';
import {
  INK,
  MINOR_COLOUR,
  PAPER,
  POWER_COLOURS,
  SEA,
  WASH_STRENGTH,
} from '../src/render/palette.ts';
import { CROP_COLOURS, mix, TERRAIN_COLOURS } from '../src/render/terrain/draw.ts';
import { SETTLEMENT_NAME } from '../src/render/terrain/places.ts';
import { WASH_DESERT_GAIN } from '../src/render/washes.ts';

export const NAME_GROUNDS = {
  paper: PAPER,
  sea: SEA,
  ...TERRAIN_COLOURS,
  ...Object.fromEntries(
    Object.entries(CROP_COLOURS).map(([name, colour]) => [`crop-${name}`, colour]),
  ),
};
export const NAME_CONTRAST_FLOOR = 7;

export function villageContrastReport(): string {
  const before = mix(INK, PAPER, 0.25);
  const backing = SETTLEMENT_NAME.stroke.color;
  const lines = [
    '# Village-name contrast',
    '',
    'WCAG sRGB relative-luminance ratios, solid glyph cores, fully faded in at closest zoom. Floor **7:1 against the immediate opaque halo** on every ground. It is not a claim that dark ink alone contrasts with dark tree/relief ink; those rows explicitly show why the backing is required. Anti-aliased glyph edges and the 220 ms entrance fade are not solid cores.',
    '',
    'Village ink changes from #675640 to #3b2816. Towns already used that ink. Both small-settlement ranks now use weight 600 so their thin italic glyphs have solid cores, with the existing opaque #f4ead0, 3 px round halo retained. Villages remain 10 px italic, below 11 px towns and 12/14 px upright city/capital names. City styles, label priorities and fades are unchanged. A bolder glyph can change its measured width and hence which nearby label wins a place.',
    '',
    `Ink/halo contrast: **${contrastRatio(before, backing).toFixed(2)} → ${contrastRatio(SETTLEMENT_NAME.fill, backing).toFixed(2)}:1**. Regenerate with \`node scripts/village-contrast.ts\`.`,
    '',
    '| Ground/drawing colour | Bare ink/ground before → after | Lowest ink/ground over all close owner washes, after | Ink/halo, every ground |',
    '| --- | --- | --- | --- |',
  ];
  for (const [name, colour] of Object.entries(NAME_GROUNDS)) {
    const tints = [
      colour,
      ...Object.values(POWER_COLOURS).map((tint) =>
        washTint(
          colour,
          tint,
          WASH_STRENGTH.greatPower * (name === 'desert' ? WASH_DESERT_GAIN : 1),
        ),
      ),
      washTint(
        colour,
        MINOR_COLOUR,
        WASH_STRENGTH.minor * (name === 'desert' ? WASH_DESERT_GAIN : 1),
      ),
    ];
    lines.push(
      `| ${name} | ${contrastRatio(before, colour).toFixed(2)} → ${contrastRatio(SETTLEMENT_NAME.fill, colour).toFixed(2)} | ${Math.min(...tints.map((c) => contrastRatio(SETTLEMENT_NAME.fill, c))).toFixed(2)} | ${contrastRatio(SETTLEMENT_NAME.fill, backing).toFixed(2)} |`,
    );
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === import.meta.filename) process.stdout.write(villageContrastReport());
