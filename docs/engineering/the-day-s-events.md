### The day's events

`tick` also returns `events`, the `DayEvent`s of the day in the order they happened: a battle began or ended, an army retreated, was destroyed, or lost men to desertion, and a war was declared. `src/sim/events.ts` defines them. An event carries what a reader needs, such as owners, a position, and men, because the records it names may be gone by the end of the day.

- Rules code calls `emit(state, event)` where the change happens. The events are kept beside the tick's copy of the state, never in it, so they are not saved and a loaded game has none. `emit` outside a recorded day drops the event, so tests that call an order handler directly need nothing.
- A script that plays the tick's steps itself wraps them in `recordEvents(state, run)`, as `scripts/sim-ai.ts` does.
- A new kind of news is a new variant of `DayEvent`, emitted at the one place the change happens.
- `tick` emits `orderUnpaid` when it refuses an order that a copy of the day, with the faction's gold raised to plenty, carries out: the order failed only for want of gold. It names the price (an offer of peace in which the sender pays is priced at the gold it asks, which it must hold though it pays only on acceptance), the gold held, and the faction's orders that spent gold earlier that day. `unpaidNewsOfDay` in `src/app/unpaid-news.ts` words it for every paying order, so a study, a building, a recruit, guards, a route or a peace the treasury could not pay never fails in silence. `reasonText` in `src/app/names.ts` writes the amounts in any refusal with the thousands comma the news uses.
