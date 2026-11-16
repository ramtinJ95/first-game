import { SvelteMap } from 'svelte/reactivity';
import type { NamedWait } from './recruit-forecast.ts';

/**
 * What each warned recruit card first named, by city and troop, until its raise is given or
 * no longer warns, so a later reading can say what moved the day. It belongs to the game the
 * page plays: entering another game forgets it, and a save does not keep it.
 */
export const namedWaits = new SvelteMap<string, NamedWait>();

export function forgetNamedWaits(): void {
  namedWaits.clear();
}
