### The clock and the panels

`src/app/clock.ts` turns real time into ticks and queues orders until the next tick. Panels never read the clock or the live state. They read `view.current` from `src/app/view.svelte.ts`, a `$state.raw` snapshot that is published about ten times a second. A click in a panel becomes an order through the clock.
