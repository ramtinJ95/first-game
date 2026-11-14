### Adding an order

1. Write `src/sim/orders/<name>.ts`. It exports the order's interface, with `kind` and `faction`, and a handler `(state, order, world) => string | undefined`. The handler checks everything before it writes anything. It returns a reason to reject, or `undefined` after it has applied the order. `ownedArmy` in `orders/owned-army.ts` does the ownership check.
2. Add `src/sim/orders/registrations/<name>.ts`, default-exporting `defineOrder(kind, handler, slot)` from `define-order.ts`. The `Order` union and the clock's slots derive from these files. An order that names an army must specify `movement` or `stance`; another order uses `undefined`.
