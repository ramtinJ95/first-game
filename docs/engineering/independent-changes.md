# Independent changes

The goal is to land parallel units without repeatedly rebasing shared registration lines. A new feature should add its own files at the extension points below. Changes to the same rule or record can still overlap; this is not a plugin system for the game itself.

## Saves

Add an immutable `src/sim/save-changes/<descriptive-name>.json` containing `{ "adds": "What the new saved state contains." }`. Do not edit an existing change, assign a number, or commit generated files. Each build's format is the sorted set of names. Order is irrelevant; missing, extra, duplicate, and malformed changes are refused before state parsing. The existing import/Continue notice names the missing changes and their descriptions, or unknown change names.

`baseline-format-12` and `peace-and-truces` represent the complete previous state. Decision: refuse legacy numeric saves rather than infer a change set that they never recorded. The notice identifies the missing changes. There is no migration or silent acceptance of a different set. Compatibility remains intentionally strict.

## Commands

For a new simulation, add `scripts/sim/<name>.ts` and run `npm run sim -- <name> [arguments]`. Discovery is by filename; no new package script or central dispatch entry is needed. All existing `sim:*` aliases remain compatible and forward through the same dispatcher, so they also regenerate before importing rules. Existing commands have one-file wrappers, including the specialized movement scripts; their old aliases and paths remain valid. `npm run sim -- --help` lists only executable commands, not internal helpers.

## Orders, slots, and alert kinds

- Add an order registration file under `src/sim/orders/registrations/`. `defineOrder` infers the exact order type from its handler, checks the kind, and requires a slot for army orders. The generated handler and slot tables share those definitions. Duplicate kinds fail explicitly when the registry loads.
- Add a JSON array of new alert-kind names under `src/app/alert-kinds/`. A file can represent one feature. Generation rejects duplicates and invalid names. The generated literal tuple preserves the `AlertKind` union and the page's runtime schema.
- These registries do not change handler execution, queue replacement, or news rules. New behavior still needs its own tests.

## Generation and documentation

`scripts/registries.ts` discovers sorted files and writes ignored static modules only when content changes. `npm ci` (`prepare`), `npm run dev`, `check`, `test`, `e2e`, and `build` regenerate them; `capture` uses that same build command. `npm run sim -- <name>` regenerates before running a script. For direct `node` commands after adding a registration, run `node scripts/registries.ts` first. If a dev server is already running when a registration is added, regenerate or restart it. Static imports deliberately keep plain Node tools, browser builds, unit tests, and the pure rules type-check on the same source; no bundler-only discovery or dependency is added.

Area guides moved from `CLAUDE.md` keep their original text, apart from the obsolete save/order/alert extension instructions updated for this change. Write area detail in its linked guide. `CLAUDE.md` keeps cross-cutting rules.

## Deliberately still shared

The actual state schemas, `DayEvent` union, systems execution order, and large news/UI rule bodies remain shared. Splitting these would change architectural boundaries or hide ordering and exhaustive checks; that is not a small registration cleanup. Two units changing the same area guide can still overlap. The historical overlap report distinguishes these remaining shared files from eliminated registration edits.
