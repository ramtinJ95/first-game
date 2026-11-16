/** A figure sheet as the budget weighs it. */
export interface HeldSheet<K> {
  readonly key: K;
  readonly bytes: number;
  /** When a frame last drew from the sheet or asked for it. */
  readonly usedAt: number;
  /** Whether the frame being drawn draws from the sheet or waits for it. */
  readonly inUse: boolean;
}

/**
 * The sheets to let go of so the rest hold at most `budget` bytes: those used longest
 * ago first, never one in use. When the sheets in use alone pass the budget, every other
 * sheet goes and those in use stay.
 */
export function sheetsOverBudget<K>(sheets: readonly HeldSheet<K>[], budget: number): K[] {
  let held = sheets.reduce((sum, sheet) => sum + sheet.bytes, 0);
  const dropped: K[] = [];
  for (const sheet of [...sheets].sort((a, b) => a.usedAt - b.usedAt)) {
    if (held <= budget) break;
    if (sheet.inUse) continue;
    dropped.push(sheet.key);
    held -= sheet.bytes;
  }
  return dropped;
}
