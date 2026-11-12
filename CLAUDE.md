# Working in this repository

Read `docs/design.md` before any work. It is the agreed design. When a task conflicts with it, stop and say so in the pull request.

## Layers

- `src/sim/` holds the game rules in pure TypeScript. It imports nothing from `src/render`, `src/ui`, `src/app`, `pixi.js`, or `svelte`, and it uses no DOM globals. `npm run check` enforces both rules through ESLint and `tsconfig.sim.json`.
- `src/render/` holds the PixiJS map renderer. It reads the state and never writes it.
- `src/ui/` holds the Svelte panels.
- `src/app/` wires the page together.
- `scripts/` holds build-time and tooling scripts. Node runs them as `.ts` files directly.
- Unit tests sit beside the code as `*.test.ts`. Playwright tests sit in `e2e/`.

## Rules code

- The game state is plain data that survives a round trip through JSON. It holds no classes and no functions.
- Ids are branded types.
- All randomness comes from the seeded generator in the state.
- The player and the AI change the state only through orders.
- Each system is one file under `src/sim/systems/`, with its tests beside it.

## Code and tests

- TypeScript strict. No `any`.
- Write a comment only for a reason the code cannot show.
- Tests assert behaviour that a player or a caller can observe, not internals.

## Commands

| Command                           | Does                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server                                                                                                 |
| `npm run build`                   | Production build to `dist/`                                                                                     |
| `npm run check`                   | svelte-check, the sim type check, ESLint, Prettier                                                              |
| `npm test`                        | Vitest unit tests                                                                                               |
| `npm run e2e`                     | Playwright tests against the built page, Chromium only                                                          |
| `npm run capture [-- <scenario>]` | Build, then write screenshots, `clip.gif`, video, and trace to `captures/<scenario>/`                           |
| `npm run capture:publish`         | Push the PNG and GIF files to the `pr-assets` branch and print Markdown for the pull request                    |
| `npm run capture:fetch`           | Pull this branch's media from `pr-assets` into `captures/`, declare it as Nexus outputs, and print the Markdown |

To show a new view, add a scenario file to `scripts/capture/scenarios/`. It default-exports `defineScenario({ name, title, run })`. `run` gets the Playwright `page` and `shot(name, title)`. The whole run becomes the clip.

CI runs `npm run capture` on every pull request and publishes the media to `pr-assets` under the branch name. The run summary holds the Markdown. If your machine cannot install Chromium, push the branch, wait for CI, and run `npm run capture:fetch`. CI keeps the full video, the trace, and the Playwright report as run artifacts.

## Git

- One branch per unit. Open a pull request to `main`. Never push to `main`. Squash merge only.
- Use Conventional Commit titles, such as `feat(sim): add movement system`.
- Add no `Co-Authored-By` trailers and no generated-by footers.
- Never commit captured media. `capture:publish` stores it on the `pr-assets` branch.
- Nexus runs `.nexus/check` (install, `npm run check`, `npm test`, `npm run build`) in a fresh pylon before it lands a pull request. A pull request that changes `.nexus/check` or `.nexus/setup` gets a hold that the owner must waive, so leave both files alone unless your brief says otherwise.

## Pull request description

Use these sections in this order: Why, What changed, Scope, Blast Radius, Verification.

- Verification lists each command you ran and its real outcome.
- A pull request that changes anything visible embeds the screenshots and at least one clip from `npm run capture`. It names its Nexus preview URL. `npm run capture` and `npm run capture:fetch` declare the media as Nexus outputs.
- A pull request that changes only rules shows the test output.

## Scope

Stay inside the paths the brief names. Note unrelated problems in the pull request and do not fix them there.
