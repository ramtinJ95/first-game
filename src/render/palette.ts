import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId, ProvinceId } from '../sim/ids.ts';
import type { PowerId } from '../sim/map.ts';
import type { GameState } from '../sim/state/game-state.ts';

export const PAPER = 0xecdfbf;
export const MARGIN = 0xcfbd96;
export const SEA = 0xb9c8c0;
export const WATER_LINE = 0x3f6b78;
export const INK = 0x3b2816;
export const BORDER = 0xa38b66;
export const RIVER = 0x557d8c;
export const LABEL_HALO = 0xf4ead0;

export const POWER_COLOURS: Record<PowerId, number> = {
  rome: 0xb3352a,
  carthage: 0x74408f,
  macedon: 0x2448c0,
  egypt: 0xcf9a28,
  persia: 0x3c7d4a,
};

export const MINOR_COLOUR = 0x8f8872;

/** How much of an owner's colour its wash lays over the paper. */
const WASH_STRENGTH = 0.45;

/**
 * The multiply tint of an owner's wash. Paper under it looks like the colour laid on it at
 * `WASH_STRENGTH`, as a painter's wash would, and ink stays ink. A plain multiply by the
 * colour would turn a blue grey on the yellow paper, the grey of the sea and the fog.
 */
export function washTint(colour: number): number {
  let tint = 0;
  for (const shift of [16, 8, 0]) {
    const paper = (PAPER >> shift) & 0xff;
    const laid = paper * (1 - WASH_STRENGTH) + ((colour >> shift) & 0xff) * WASH_STRENGTH;
    tint |= Math.min(255, Math.round((laid / paper) * 255)) << shift;
  }
  return tint;
}

export function factionColour(state: DeepReadonly<GameState>, faction: FactionId): number {
  if (state.factions[faction]?.kind !== 'greatPower') return MINOR_COLOUR;
  return Object.hasOwn(POWER_COLOURS, faction)
    ? POWER_COLOURS[faction as string as PowerId]
    : MINOR_COLOUR;
}

/** A province belongs to whoever owns its city. */
export function provinceOwner(
  state: DeepReadonly<GameState>,
  province: ProvinceId,
): FactionId | undefined {
  const city = state.provinces[province]?.city;
  return city && state.cities[city]?.owner;
}
