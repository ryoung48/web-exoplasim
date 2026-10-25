# AGENTS.md

NEVER git stash without asking for permission first.

Do not write doc comments. The code should speak for itself. If you see verbose doc strings, please remove them.

Before finishing any TypeScript or TSX code change in this repository, verify it with:

- `pnpm lint`
- `pnpm typecheck`

Unless the user explicitly asks for backwards compatibility, never preserve or optimize for backwards compatibility.

Always check for duplicated logic before adding new code. Reuse or extract shared logic instead of copying behavior into another file.

Avoid barrel files. Import from the concrete module you need instead of adding or expanding `index.ts` re-export layers. This applies to a single stray `export {...} from "./x"` / `export type {...} from "./y"` statement mixed into an otherwise-real file too, not just a whole pass-through file.

## Refactoring
- Use `scripts/refactor/rename-symbol.mjs <file> <oldName> <newName>` to rename a top-level exported symbol — updates every project-wide reference, including property-access usages like `OLD_NAME.someMethod`.
- Use `scripts/refactor/move-module.mjs <from> <to>` to move/rename files or folders — rewrites every importer (relative and `@/...` alias) project-wide.
- Use `scripts/refactor/move-symbol.mjs <fromFile> <toFile> <symbol...>` to extract named exports into another file — moves the declarations, resolves transitive imports on both ends, drops now-unused imports in the source file, and repoints every importer.

## Implementation expectations

- Make the smallest change that fully solves the problem.
- Follow existing patterns before introducing a new abstraction.
- Do not create a utility until there are at least two genuine callers.
- Never use `_`-prefixed names to hide intentionally unused variables or parameters. Remove the unused variable, parameter, and any dead call-site argument instead.
- All class implementations must have clear documentation explaining why the class is needed. Avoid classes and OOP where possible.
- All optional type attributes must have a nearby comment containing `[JUSTIFICATION]` and explaining why they are optional. Avoid optional types where possible.
- Functions take at most one parameter. If a function needs more than one input, bundle them into a single object parameter (its type declared in the domain's `types.ts`, not inline). Exception: callbacks passed to native APIs whose call signature isn't ours to change (e.g. `Array.prototype.sort`/`reduce`/`map` comparators/callbacks). This is an interim manual rule until `lint/nursery/useMaxParams` is enabled in `biome.json`.
- always use string unions instead of enums

# Module conventions (src/model)

- **A domain is a distinct noun/concept** in the world model (`Cell`, `Province`, `Nation`) with its own shape + operations — or a layer that plays the same structural role (`shapers`, `hooks`, `utilities`).
- **One UPPERCASE namespace object per domain** (`NATION`, `PROVINCE`, `CELL`) as its public API — not free functions, not a class.
- **A folder that only groups unrelated domains (e.g. `celestial/` holding `star`, `moons`, `system`) is a category, not a domain.** Don't give it its own namespace object — a wrapper like `CELESTIAL` with no operations of its own, just delegating to `STAR`/`MOON`/`SYSTEM`, is a sign the folder should stay a plain directory. Give each real sub-domain inside it its own namespace object and its own barrel; don't collapse them behind one mega-barrel at the category folder's `index.ts`, since that's what invites everyone to reach past it into internals instead.
- **`types.ts` = shape, `index.ts` = behavior.** Import types from the concrete `types.ts` module; barrels must not export types. Never inline a type into its logic file just because only one file uses it — even a single-consumer type belongs in a `types.ts`. A flat top-level file in a domain folder (other than `index.ts`/`types.ts`) belongs in its own `<name>/{index.ts,types.ts}` submodule — promote it rather than breaking the split.
- **Runtime barrel-only.** Import runtime APIs from a folder's `index.ts`, never reach into its internals. Type-only imports intentionally point to the concrete `types.ts` module because barrels do not include types.
- **The barrel is the entry point, not a pass-through.** `index.ts` should export the domain's namespace object, not just re-export free functions/constants pulled in from sibling files with no namespace wrapping them — that's a re-export shim, not an API, whether it's the whole file or one stray statement in it. A file that's only `export { X } from "./a"` / `export type { Y } from "./b"` lines is the smell: either the sub-folder isn't a real sub-domain and should collapse into its parent, or its runtime exports need wrapping in a namespace object. Either way, redirect every consumer to the concrete module — never leave the re-export in place.
- **Export the namespace object only, never its members destructured out alongside it.** Don't add `export const { fn1, fn2 } = DOMAIN` next to `export const DOMAIN = {...}` — callers use `DOMAIN.fn1`. A namespace's public surface should only include functions outside callers actually call — if nothing outside the domain calls a method, don't export it at all (keep it un-exported or `_`-prefixed private).
- **`_`-prefixed methods are private.** Don't call them from outside their namespace object; do not export them at all.
- **Nest sub-folders only for real sub-domains** (own types + operations worth a barrel), not for arbitrary depth. A type used by exactly one file counts as that file owning a real sub-domain: if that file is not the domain's `index.ts` entry point, promote it to its own `<name>/{index.ts,types.ts}` submodule instead of leaving the type in the parent `types.ts` or inlining it. 
- **Split a domain once its `index.ts` mixes multiple sub-concerns or grows past ~250-500 lines** (e.g. `cells` → `geography`/`navigation`/`weather`). When splitting: extract each sub-concern into its own `sub-folder/{index.ts,types.ts}`, keep the parent namespace object as the entry point, and have the parent re-export or delegate to the sub-domain's namespace object rather than inlining its logic.
- **Reusable logic that isn't specific to the domain doesn't belong in a domain file** — move it to the most specific existing `shared/*` sub-module (`math`, `array`, `text`, …), or create a new specific one. Avoid dumping it into a catch-all/generic file.

# UI Conventions
- Keep business logic out of React components.
- For any UI or UX work, follow `src/ui/components/UI.md`.

# Plans
- Do not create a plan file unless the user explicitly asks for one. Routine changes, fixes, verification runs, and follow-up work do not need new plan files.
- All plans live in the `plans/` folder as files. Do not keep plans only in chat or scatter them elsewhere.
- Once a plan is fully implemented, move its file to `plans/archive/`.
- Every constant a plan introduces must be assigned a concrete value in the plan, with a citation (source, paper, dataset, or documented reasoning) explaining why that value makes sense. Plans must not leave constants as TBD, "tune later", or unvalued placeholders.
- Structure plans using [axiomatic design](https://web.mit.edu/axiom/www/introduction.shtml). Use these sections in this order:
  1. **Objective** — State the problem, intended outcome, scope, constraints, and explicit exclusions.
  2. **FRs (Functional Requirements)** — Number requirements as `FR1`, `FR2`, etc. Describe the minimum set of independent, verifiable behaviors needed to meet the objective, without prescribing implementation. Decompose only when needed, retaining parent IDs (e.g. `FR1.1`).
  3. **DPs (Design Parameters)** — Number design choices as `DP1`, `DP2`, etc., mapping each to its corresponding FR. Specify concrete mechanisms, algorithms, state, and parameter values; reuse existing behavior where possible. Decompose FRs and DPs together so their mappings remain explicit.
  4. **Matrix** — Show the design matrix with FRs as rows and DPs as columns. Mark `X` wherever changing a DP affects an FR and `—` otherwise; include cross-effects, not just intended mappings. Apply the Independence Axiom: prefer an uncoupled (diagonal) matrix, or a decoupled (triangular after ordering) matrix with the required design/implementation sequence stated. Redesign coupled mappings where possible; identify and justify any remaining coupling. Among designs satisfying independence, apply the Information Axiom by preferring the design with the highest supported probability of satisfying the FRs; state the evidence and uncertainty rather than inventing numerical probabilities.
  5. **Expectations** — Estimate changes in relevant statistics and latency relative to the applicable baseline. Name the metrics, units, workload/configuration, expected direction and approximate magnitude or range, and the evidence or reasoning behind each estimate. Separate behavioral statistics from execution latency, and state assumptions and uncertainty; if a useful numerical estimate is unsupported, explain why and give a directional expectation. These estimates ground the design discussion; they are not acceptance criteria or pass/fail gates. Compare observed results with expectations to explain differences, without treating a missed estimate as a failure by itself.
  6. **Verification** — Map every FR to concrete checks and acceptance criteria. Include required lint/type checks, relevant tests, and applicable benchmark comparisons from `scripts/exoplasim-wasm/run-browser.mjs`, with their exact paths and configuration.
  7. **Documentation updates** — Reference documentation lives in `docs/`. Review the relevant existing docs before planning changes. List exact repository-relative paths and explicitly label each action: **create** a new document, **edit** an existing document, or **move/split** existing content. For each action, identify the sections or topics and the behavior or decisions to document. For moves or splits, specify source and destination paths and the links to update. If no documentation changes are needed, state why.
  8. **Module organization** — Specify the files, domains, submodules, types, public namespace APIs, and dependency direction for the DPs, following the repository's module conventions. Identify existing logic to reuse or extract and explain why any new module is needed.
- Keep reference documents focused and easy to navigate. When a document mixes distinct concerns or becomes too large to scan comfortably, plan a split into focused documents. Group related documents in descriptive subfolders under `docs/` where the topic warrants it, following the existing domain structure; avoid arbitrary nesting. Keep a concise overview linking to the detailed documents, update affected links, and move shared explanations rather than duplicating them.

# Plan Review
- Sometimes you will be asked to review a plan. Make sure you understand the objective of the plan. Reviews should look for:
  - Incoherence: contradictions between sections, steps that don't follow from the stated goal, or references to things the plan never defines.
  - Over-engineering: abstractions, phases, or generality beyond what the problem requires.
  - Vague requirements: steps or acceptance criteria that can't be implemented or verified without guessing.
  - Axiomatic structure: require the eight plan sections above, with traceable objective → FR → DP → verification mappings and no implementation choices disguised as FRs.
  - Expectations: check that estimated statistic and latency changes identify their baseline, units, assumptions, and supporting reasoning, and remain separate from acceptance criteria.
  - Design independence: check the matrix for omitted cross-effects, unjustified coupling, and missing ordering for a decoupled design; check that design alternatives and reliability claims have supporting evidence.
  - Module structure: where applicable, check that the plan lays out modules, submodules, and where each piece of code lives.
  - Documentation scope: require explicit create/edit/move/split actions with exact paths under `docs/`, clear content changes, and any necessary link updates. Flag oversized or mixed-concern documents that should be split into focused files and sensible subfolders.
  - Unjustified constants: flag any constant without an assigned value, or whose value lacks a citation explaining why it makes sense.

# Parallel Agents
- Other agents are often working in this repo at the same time. Uncommitted changes you didn't make, including ones related to your work, are probably theirs: don't panic, don't revert or clean them up.
- Stick to the files your task needs.
- Never run commands that change working-tree state or interrupt other agents: `git stash`, `git checkout`, `git switch`, `git restore`, `git reset`, `git clean`, or anything similar.

# ExoPlaSim port
- The browser build of ExoPlaSim lives in `scripts/exoplasim-wasm/`; follow its `README.md` to set up the WSL toolchain and rebuild `public/gcm/` with `pnpm build:gcm-wasm`.
- Design notes, measurements and benchmark history are in `docs/climate/exoplasim-wasm.md`. Record new measurements there.
- Model code is in `src/model/climate/gcm/`, the page in `src/ui/gcm/`.
- After changing Fortran, the shared-memory layer (`mpimod_shm.f90`, `library_shm.js`) or the snapshot hook (`gcm_publish.f90`, `library_gcm.js`), rebuild without `--link-only`; relinking old objects against a changed JS library breaks call signatures.
- Benchmarks use `scripts/exoplasim-wasm/run-browser.mjs` and write reports under the gitignored `stats/`. Never overlap two benchmarks or a benchmark with a running `/gcm` page.
