import * as v from 'valibot';
import { PAUSE_KINDS, type Alert, type PauseKind } from './alerts.ts';

/** Which news stops the game, as the player set it in the Game menu. */
export type PauseSettings = Readonly<Record<PauseKind, boolean>>;

/** What each setting says in the Game menu. */
export const PAUSE_LABELS: Record<PauseKind, string> = {
  battle: 'A battle begins with 500 of your men or a tenth of your field army',
  weakSiege: 'Your siege is too weak to starve the city',
  sighted: 'An enemy army first nears your land in a war',
  ownCity: 'Your city is besieged, in danger, or falls',
};

export const ALL_PAUSES: PauseSettings = {
  battle: true,
  weakSiege: true,
  sighted: true,
  ownCity: true,
};

/** Local storage keeps the settings under this key, across games. */
const KEY = 'pauses';

const StoredSchema = v.partial(
  v.object(Object.fromEntries(PAUSE_KINDS.map((k) => [k, v.boolean()]))),
);

export function readPauses(storage: Storage | undefined): PauseSettings {
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? v.safeParse(StoredSchema, JSON.parse(raw)) : undefined;
    return parsed?.success ? { ...ALL_PAUSES, ...parsed.output } : ALL_PAUSES;
  } catch {
    return ALL_PAUSES;
  }
}

export function writePauses(storage: Storage | undefined, settings: PauseSettings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be blocked. The settings then last until the page closes.
  }
}

/**
 * The day's news with the alerts that stop the game marked `paused`, and the keys of
 * news told once, such as the first enemy seen in a war, which then stop the game no
 * more. A key is spent whether or not its setting stopped the game, so turning the
 * setting on later does not stop for the fifth enemy of a war.
 */
export function stopsOfDay(
  news: readonly Alert[],
  settings: PauseSettings,
  told: ReadonlySet<string>,
): { news: Alert[]; told: Set<string>; stop: boolean } {
  const spent = new Set(told);
  let stop = false;
  const marked = news.map((alert): Alert => {
    if (!alert.pause) return alert;
    const { kind, once } = alert.pause;
    if (once !== undefined) {
      if (spent.has(once)) return alert;
      spent.add(once);
    }
    if (!settings[kind]) return alert;
    stop = true;
    return { ...alert, paused: true };
  });
  return { news: marked, told: spent, stop };
}
