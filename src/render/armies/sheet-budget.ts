/** A figure sheet as the budget weighs it. */
export interface HeldSheet<K> {
  readonly key: K;
  readonly bytes: number;
  /** How many sheet sizes lie between the sheet's size and the one the view last asked for. */
  readonly distance: number;
  /** When a frame last drew from the sheet or asked for it. */
  readonly usedAt: number;
  /** Whether the frame being drawn draws from the sheet or waits for it. */
  readonly inUse: boolean;
}

/**
 * The sheets to let go of so the rest hold at most `budget` bytes, never one in use. A
 * zoom passes through the sizes in turn, so the sheets furthest in size from the one in
 * view go first, and of those the ones used longest ago. When the sheets in use alone
 * pass the budget, every other sheet goes and those in use stay.
 */
export function sheetsOverBudget<K>(sheets: readonly HeldSheet<K>[], budget: number): K[] {
  let held = sheets.reduce((sum, sheet) => sum + sheet.bytes, 0);
  const dropped: K[] = [];
  const order = [...sheets].sort((a, b) => b.distance - a.distance || a.usedAt - b.usedAt);
  for (const sheet of order) {
    if (held <= budget) break;
    if (sheet.inUse) continue;
    dropped.push(sheet.key);
    held -= sheet.bytes;
  }
  return dropped;
}
