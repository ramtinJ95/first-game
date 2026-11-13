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
  carthage: 0x6b3aa3,
  macedon: 0x2448c0,
  egypt: 0xcf9a28,
  persia: 0x3c7d4a,
};

export const MINOR_COLOUR = 0x8f8872;

/**
 * How much of an owner's colour its wash lays over the ground: the paper, the desert, or
 * the wood. The colour is laid on, not multiplied, so it keeps its hue on the yellow
 * desert, where a multiply turned Carthage's violet into Rome's red and Macedon's blue grey.
 * A power's wash leaves the ground and its drawings readable through it, and a minor's is
 * lighter still, so the many small realms do not grey the map.
 */
export const WASH_STRENGTH = { greatPower: 0.34, minor: 0.14 } as const;

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
