import type { Slot } from '../app/saves.ts';
import type { PowerId } from '../sim/map.ts';
import type { Order } from '../sim/orders/orders.ts';

/** A working title until the game has a name of its own. */
export const GAME_NAME = 'The Middle Sea';

/** What the screens round the game may do: start, end, save, and load a game. */
export interface FrameActions {
  choosePower(power: PowerId): void;
  /** Loads the save written last, which `latestSaved` names. */
  continueGame(): void;
  showStart(): void;
  openGuide(): void;
  /** Closes the modal in front. A game that a modal stopped runs again after the last one. */
  closeModal(): void;
  /** Closes the defeat screen and runs the game on without the player. */
  watchOn(): void;
  /** Issues the fate's order and closes its prompt. Occupying gives no order. */
  decideFate(order: Order | undefined): void;
  setPauseOnFate(on: boolean): void;
  saveToBrowser(): void;
  loadFromBrowser(slot: Slot): void;
  exportFile(): void;
  importFile(file: File): void;
}
