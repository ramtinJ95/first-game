## Commands

| Command                                       | Does                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                 | Vite dev server                                                                                                                                             |
| `npm run build`                               | Production build to `dist/`                                                                                                                                 |
| `npm run check`                               | svelte-check, the sim type check, ESLint, Prettier                                                                                                          |
| `npm test`                                    | Vitest unit tests                                                                                                                                           |
| `npm run e2e`                                 | Playwright tests against the built page, Chromium only                                                                                                      |
| `npm run sim:battles [-- --log <row> <seed>]` | Play the battle matchups over many seeds and print the tuning table, or one battle day by day                                                               |
| `npm run sim:economy`                         | Play the new game for three years without orders and print each great power's economy at the end of each year                                               |
| `npm run sim:paths`                           | Compare grid and navigation-mesh path finding with the exact shortest path                                                                                  |
| `npm run sim:movement`                        | Print long routes, their marching days and path times, and the tick time with every army marching                                                           |
| `npm run map:routes`                          | Draw long routes on the map preview into `captures/movement/`                                                                                               |
| `npm run sim:sieges`                          | Play the siege, storm, relief, and fate cases and print the tuning table                                                                                    |
| `npm run sim:ai [-- --seeds <n> --years <n>]` | Play the new game under the AI, with every faction and with a passive Rome, and print the tuning tables, battle lengths, and beaten armies alive 30 days on |
| `npm run sim:opening`                         | Play the scripted opening of each great power against its nearest minor city on 5 seeds                                                                     |
| `npm run sim:world`                           | Play the new game for ten years under the AI and print who leads, who lives, and how often the AI repeats a siege                                           |
| `npm run sim:recruit`                         | Have Rome raise every troop it can afford and count what it waits for                                                                                       |
| `npm run sim:buildings`                       | Print the building table, each building's payback by city, and four Romes at peace that idle, recruit, build, or both                                       |
| `npm run sim:peace`                           | Play the new game under the AI and print how wars end, how long they run, and the days each power spends at peace                                           |
| `npm run sim:news [-- --seeds 5 --years 3]`   | Play the new game as Rome, idle and under the AI, and count the lines of news a year in the corner and in the chronicle                                     |
| `npm run capture [-- <scenario>]`             | Build, then write screenshots, `clip.gif`, video, and trace to `captures/<scenario>/`                                                                       |
| `npm run capture:publish`                     | Push the PNG and GIF files to the `pr-assets` branch and print Markdown for the pull request                                                                |
| `npm run capture:fetch`                       | Pull this branch's media from `pr-assets` into `captures/`, declare it as Nexus outputs, and print the Markdown                                             |

To show a new view, add a scenario file to `scripts/capture/scenarios/`. It default-exports `defineScenario({ name, title, run })`. `run` gets the Playwright `page` and `shot(name, title)`. The whole run becomes the clip.

CI runs `npm run capture` on every pull request and publishes the media to `pr-assets` under the branch name. The run summary holds the Markdown. If your machine cannot install Chromium, push the branch, wait for CI, and run `npm run capture:fetch`. CI keeps the full video, the trace, and the Playwright report as run artifacts.
