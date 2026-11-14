### The day's events

`tick` also returns `events`, the `DayEvent`s of the day in the order they happened: a battle began or ended, an army retreated, was destroyed, or lost men to desertion, and a war was declared. `src/sim/events.ts` defines them. An event carries what a reader needs, such as owners, a position, and men, because the records it names may be gone by the end of the day.

- Rules code calls `emit(state, event)` where the change happens. The events are kept beside the tick's copy of the state, never in it, so they are not saved and a loaded game has none. `emit` outside a recorded day drops the event, so tests that call an order handler directly need nothing.
- A script that plays the tick's steps itself wraps them in `recordEvents(state, run)`, as `scripts/sim-ai.ts` does.
- A new kind of news is a new variant of `DayEvent`, emitted at the one place the change happens.
