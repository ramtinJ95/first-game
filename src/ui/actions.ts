import type { Alert } from '../app/alerts.ts';
import type { Speed } from '../app/clock.ts';
import type { Pick } from '../render/pick.ts';
import type { Order } from '../sim/orders/orders.ts';

/** Everything a panel may do. Orders go to the clock; nothing here writes the state. */
export interface Actions {
  togglePause(): void;
  setSpeed(speed: Speed): void;
  issue(order: Order): void;
  select(pick: Pick | undefined): void;
  openAlert(alert: Alert): void;
  closeMenu(): void;
}
