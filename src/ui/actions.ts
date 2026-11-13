import type { Alert } from '../app/alerts.ts';
import type { Speed } from '../app/clock.ts';
import type { Pick } from '../render/pick.ts';
import type { CityId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { MapPoint } from '../sim/state/map-point.ts';

/** Everything a panel may do. Orders go to the clock; nothing here writes the state. */
export interface Actions {
  togglePause(): void;
  setSpeed(speed: Speed): void;
  issue(order: Order): void;
  select(pick: Pick | undefined): void;
  /** Selects what the pick points at and centres the map on the point. */
  show(pick: Pick, at: MapPoint): void;
  openAlert(alert: Alert): void;
  closeMenu(): void;
  /** Settles a captured city's fate by occupying it as it stands, which the rules need no order for. */
  occupy(city: CityId): void;
}
