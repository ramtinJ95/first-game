export const POWERS = ['rome', 'carthage', 'macedon', 'egypt', 'persia'] as const;
export type PowerId = (typeof POWERS)[number];
export type StartingOwner = PowerId | 'independent';

export function isStartingOwner(value: unknown): value is StartingOwner {
  return value === 'independent' || POWERS.some((power) => power === value);
}
