import { colourDistance, washTint } from '../src/render/colour-distance.ts';
import { MINOR_COLOUR, PAPER, POWER_COLOURS, washStrength } from '../src/render/palette.ts';
import { TERRAIN_COLOURS } from '../src/render/terrain/draw.ts';
import { WASH_DESERT_GAIN } from '../src/render/washes.ts';

export const WASH_GROUNDS = {
  bare: PAPER,
  desert: TERRAIN_COLOURS.desert,
  steppe: TERRAIN_COLOURS.dryGround,
  arid: TERRAIN_COLOURS.aridGround,
  farmland: TERRAIN_COLOURS.cultivated,
  forest: TERRAIN_COLOURS.wood,
  mountain: TERRAIN_COLOURS.reliefShade,
};
const before = { ...POWER_COLOURS, egypt: 0xcf9a28, minors: 0x8f8872 };
const after = { ...POWER_COLOURS, minors: MINOR_COLOUR };

export function colourReport(): string {
  const lines = [
    '# Atlas ownership contrast',
    '',
    'CIE76 ΔE, D65 Lab converted from sRGB. Each cell is **before → after**; dash is self-comparison. Floor: **10** for every owner against the bare ground and every other owner on that same ground, including minors. Regenerate with `node scripts/map-colours.ts`.',
    '',
    'These are full-strength wash interiors at atlas scale (0.17 px/km), using the actual normal-alpha composition and desert gain. Border fades necessarily reach zero; owner-coloured boundary ink carries those edges, and a cream halo/double-weight stroke identifies the player first. Relief ink and opaque drawing highlights are not ownership pixels. The mountain row is the representative shaded-ground swatch, not a claim that opaque ink is tinted. At 0.9 px/km and closer the original 0.34/0.14 wash strengths return.',
  ];
  for (const [ground, colour] of Object.entries(WASH_GROUNDS)) {
    const washes = (colours: typeof before, strengths: { greatPower: number; minor: number }) =>
      Object.fromEntries(
        Object.entries(colours).map(([owner, tint]) => [
          owner,
          washTint(
            colour,
            tint,
            (owner === 'minors' ? strengths.minor : strengths.greatPower) *
              (ground === 'desert' ? WASH_DESERT_GAIN : 1),
          ),
        ]),
      ) as Record<keyof typeof before, number>;
    const a = washes(before, { greatPower: 0.34, minor: 0.14 });
    const b = washes(after, washStrength(0.17));
    const owners = Object.keys(after) as (keyof typeof after)[];
    lines.push(
      '',
      `## ${ground}`,
      '',
      `| Owner | Ground | ${owners.join(' | ')} |`,
      `|${Array(owners.length + 2)
        .fill('---')
        .join('|')}|`,
    );
    for (const owner of owners) {
      const difference = (other: keyof typeof before | undefined) => {
        if (other === owner) return '—';
        return `${colourDistance(a[owner], other ? a[other] : colour).toFixed(1)} → ${colourDistance(b[owner], other ? b[other] : colour).toFixed(1)}`;
      };
      lines.push(`| ${owner} | ${difference(undefined)} | ${owners.map(difference).join(' | ')} |`);
    }
  }
  return lines.join('\n') + '\n';
}

if (import.meta.main) console.log(colourReport());
