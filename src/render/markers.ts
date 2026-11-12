import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, FactionId } from '../sim/ids.ts';
import type { Army } from '../sim/state/army.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';

/** A banner in screen pixels, from the foot of its pole, which stands on the army's position. */
export const BANNER = { pole: 30, flagWidth: 20, flagHeight: 13 } as const;

/**
 * The clickable part of a banner, relative to its foot. It leaves out the lower pole,
 * so the city an army stands on stays clickable.
 */
export const BANNER_HIT = {
  left: -4,
  right: BANNER.flagWidth + 3,
  top: -BANNER.pole - 3,
  bottom: -12,
};

export interface DrawnArmy {
  readonly id: ArmyId;
  readonly owner: FactionId;
  readonly position: MapPoint;
}

function landPosition(army: DeepReadonly<Army>): MapPoint | undefined {
  return army.activity.kind === 'embarked' ? undefined : army.activity.position;
}

/**
 * Where to draw each army on land, `progress` of the way from where it stood on the
 * previous day to where it stands now. An army that was not on land the day before
 * appears at its current position.
 */
export function drawnArmies(
  previous: DeepReadonly<GameState>,
  current: DeepReadonly<GameState>,
  progress: number,
): DrawnArmy[] {
  const drawn: DrawnArmy[] = [];
  for (const army of Object.values(current.armies)) {
    const to = landPosition(army);
    if (!to) continue;
    const before = previous.armies[army.id];
    const from = (before && landPosition(before)) ?? to;
    drawn.push({
      id: army.id,
      owner: army.owner,
      position: { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress },
    });
  }
  return drawn;
}
