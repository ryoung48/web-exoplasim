# Faster browser GCM

## 1. Objective

**Problem.** The `/gcm` page runs ExoPlaSim at about 2 model days/s at T21 and 0.30 model days/s at T42 (8 ranks, double precision; `docs/climate/exoplasim-wasm.md`, "Chaos Machine `/gcm` page"). A T42 model year takes 11–20 minutes. That is slow for reaching equilibrium, which `balance` needs at least 14 model years to judge.

The existing measurements point to two remaining costs:

1. **Wasm code quality.** `compile.py` emits LLVM IR with Flang at `-O0` and optimizes only afterwards with clang `-O2`. Array assignments stay as calls into the Flang runtime. Generic runtime assignment is still 12.3% of sampled Wasm time at T21 double and 15.0% at T42 double. In an earlier test, frontend `-O3` cut assignment call sites in the main module from 360 to 61, but the browser check produced NaNs, so it was dropped. The cause was never isolated. The native reference compiles the same sources with `flang-new -O2` and runs correctly, so the NaNs are probably specific to the Wasm path (the IR ABI repair in `compile.py`, or one file's undefined behaviour). They probably don't come from Fortran semantics.
2. **Barrier idle time.** At 8 ranks each rank spends 1.4–2.6 s of a 7.4 s ten-day T21 run waiting in barriers. Changing the spin budget did not help, so the wait is ranks waiting on each other. `mpscgp`/`mpgagp` hand each rank a contiguous block of `NLPP` latitude rows, ordered north to south. Rank 0 therefore holds only polar rows and the middle ranks only tropical rows, while physics cost (convection, daylit radiation, sea ice) depends on latitude and season.

**Intended outcome.** Higher model throughput (model days per wall-clock second) on the `/gcm` page and in `run-browser.mjs` benchmarks at T21 and T42, with every rank count the page ships (2, 4, 8).

**Constraint C1 (fidelity).** Every change must keep output within the per-value error budgets in `docs/climate/exoplasim-wasm.md` against the current default build at 2 steps and 48 steps: 10⁻⁶ K for temperatures, 10⁻⁶ m/s for winds, 10⁻⁴ Pa for pressure, and 10⁻¹⁰ for specific humidity. Ten-day global means must stay finite and close to the reference. Bitwise identity is not required, because reduction order and inlined intrinsics may change the last bits.

**Scope.** `scripts/exoplasim-wasm/` (build, compile, shared-memory layer, benchmark runner), a rebuild of `public/gcm/`, and documentation.

**Exclusions.**
- Single precision as the page default. It is 16% faster at T42, but multi-year stability is unchecked. That is a fidelity decision, not a speed fix.
- SIMD and LLVM `-O3`. These were measured slower (30.9 s vs 20.5 s, ten days serial).
- Emscripten host JS math. It diverged by 11 K after ten days.
- Barrier spin tuning. Budgets from 0 to 2×10⁶ loads made no difference beyond noise.
- More ranks than physical cores. Hyperthreads slowed native runs.
- A longer default radiation interval. It is already a user setting and changes physics.
- Main-thread work on the page (downscaling, redraw). Its only measurement, a 10% loss, was taken while another run shared the machine. It gets re-measured after this plan, not redesigned now.
- Changing PlaSim's physics or replacing `pow`. The `pow` share is re-profiled after DP1. Any follow-up goes in a separate plan.

## 2. FRs

- **FR1** — Each rank's computation per model step takes less Wasm execution time.
- **FR2** — Ranks spend less time waiting for each other at collectives, measured as the share of rank time spent in `SHM.barrier`.

C1 applies to both.

## 3. DPs

### DP1 — Optimize Fortran in the Flang frontend, file by file (→ FR1)

- **DP1.1 — Frontend level.** `compile.py` passes `-O2` instead of `-O0` to `flang-new -S -emit-llvm`. The exception is any file listed in a new `FRONTEND_O0_FILES` constant in `build.py`, which `build.py` hands to `compile.py` through the environment, the same way `EXOPLASIM_CODEGEN_FLAGS` is passed today. A `--frontend-opt 0|2` build option (default `2`) keeps the `-O0` build available for comparisons, as `--assignment generic` does for the runtime. `build.json` records the level and the exclusion list.
  - *Value `-O2`:* the native reference already compiles every source with `flang-new -O2` and is the accepted numerical reference, so `-O2` lowering is known to be correct for this code natively. It also matches the existing clang codegen level (`-O2`). `-O3` was the level that failed, and nothing shows it beats `-O2` for scalar Wasm (LLVM `-O3` was slower).
  - *Value `FRONTEND_O0_FILES`:* starts empty. DP1.2 fills it with exactly the files whose `-O2` IR breaks the C1 check, and with no others.
- **DP1.2 — Isolate the files that fail (procedure).** Build 8-rank T21 with every file at `-O2` and run the 2-step reference check against the `-O0` build. If it fails (NaN, build error from the `compile.py` ABI repair, or an error-budget breach), bisect the 51 sources in the model's `OBJ` list by halving the set compiled at `-O2`. That takes ⌈log₂ 51⌉ = 6 rounds per failing file. Put each failing file in `FRONTEND_O0_FILES`, together with the suspected cause: an `ABI repair` pattern the regexes miss in optimized IR, or undefined behaviour similar to the uninitialized `hurricaneini` imports already fixed in `build.py`. If the cause is a missed ABI repair pattern, fix `compile.py` instead and take the file back off the list. That is preferred because it keeps the file optimized.
- **DP1.3 — Rebuild the runtime check.** Rerun `verify-runtime.py` unchanged. The bulk-fill runtime patch stays, because fewer calls reach it but the remaining ones still benefit.

### DP2 — Balance latitude rows across ranks (→ FR2)

DP2 is decoupled from DP1 and runs after it (see Matrix).

- **DP2.1 — Measure imbalance after DP1.** Add a `lastArrivals` counter to `SHM.state.stats` in `library_shm.js`, incremented by the rank whose `Atomics.add` releases the barrier (the slowest arriver). For each rank, `busy = rankSimulationMs − barrierMs`; both already appear in the `run-browser.mjs` summary. Go on to DP2.2 only if `max(busy) / mean(busy) ≥ 1.10` in the 8-rank T21 ten-day run, and the ranks with the highest `busy` are not rank 0 alone.
  - *Value 1.10:* the run-to-run spread of 8-rank ten-day runs is 1.2% (7.39–7.48 s). A 10% excess is about 8× that noise. At a 7.4 s run, 10% is a recoverable saving of at least about 0.5 s. A lone rank-0 straggler points to root-only serial work. Interleaving rows cannot fix that, so it is reported and left out of scope.
- **DP2.2 — Cyclic latitude decomposition.** Local row `k` (0-based) of rank `r` maps to global row `k × NPRO + r`, instead of `r × NLPP + k`. At T21 with 8 ranks, rank `r` holds rows `r, r+8, r+16, r+24`: two northern and two southern rows spread from pole to equator.
  - *Value (stride `NPRO`):* this is the cyclic distribution used to even out latitude-dependent physics cost in parallel spectral climate models (Foster & Toonen, "Load-balancing algorithms for climate models", SHPCC 1994). It needs no runtime cost model and keeps every rank's row count at `NLPP`.
  - *Mechanism:* the permutation lives entirely in the shared-memory layer. `shm_blocks` gains a `krows` argument. With `krows = NLPP`, rank `r`'s local chunk of `chunk` elements is split into `krows` rows of `chunk / krows` elements, and each row is copied to or from global row `k × NPRO + r`. With `krows = 1` it behaves as today. In `mpimod_shm.f90` the latitude-structured collectives pass `NLPP`: gridpoint scatter/gather/allgather (`mpscgp`, `mpgagp`, `mpgallgp`) and the per-latitude vectors (`mpscdn`, `mpscrn` for `sid`, `gwd`, `csq`, `rcs`). So do the two rewritten `utilities.f90` gathers, if their `n` is `NHOR`-structured. Spectral (`mpscsp`, `mpgasp`, `mpsumsc`, …) and scalar or integer broadcasts pass `1`.
  - *Precondition audit:* before enabling DP2.2, grep the model sources for global row index assumptions on local data: `mypid` arithmetic (none found in `plasim.f90`, `legmod.f90`), `NLAT/2` hemisphere tests on local `jlat`, and meridional neighbour stencils in gridpoint code. List every hit in the implementation PR and either route it through the permutation or confirm that it reads only gathered global arrays. Also classify `mpscin` call sites as latitude-structured or not.
  - *Build option:* `--decomposition block|cyclic` (default `cyclic` once accepted), recorded in `build.json`. `worker.js`/`run-browser.mjs` place rank `r`'s `wasm-fields.txt` row `k` at global row `k × NPRO + r` when `build.json` says `cyclic`, so field comparisons stay in global order. Snapshots and restart files already pass through `mpgagp` and stay in global order, so the TypeScript in `src/model/climate/gcm/` and checkpoint format 2 are unchanged.

## 4. Matrix

| | DP1 (frontend `-O2`) | DP2 (cyclic rows) |
| --- | --- | --- |
| FR1 per-rank compute | X | — |
| FR2 barrier wait share | X | X |

**Decoupled (lower-triangular).** DP1 changes the absolute size and possibly the latitude profile of each rank's work, so it shifts the imbalance DP2 addresses. DP2 moves rows between ranks but does not change the cost of computing a row, so it does not affect FR1. A small cache-locality effect from non-adjacent rows is possible and is checked in Verification. **Required order:** implement and accept DP1 → measure DP2.1 on the DP1 build → implement DP2.2 only if its gate passes.

**C1 cross-effects:** both DPs can alter output bits. DP1 does it through inlined intrinsics and reassociation-free reordering. Scalar Wasm has no FMA, so contraction cannot occur. DP2 does it through the order of reductions in Legendre partial sums. Both are checked against the same budgets.

**Information Axiom.**
- *DP1:* the alternative is extending the runtime bulk-fill patch to more assignment kinds. That covers only assignment calls the runtime sees and leaves the other `-O0` lowering untouched. Frontend `-O2` removes the calls at the source. It is backed by the 360 → 61 call-site reduction and by native `-O2` correctness. The uncertainty is how many files need `-O0` fallback, which DP1.2 bounds.
- *DP2:* alternatives are a measured cost-model assignment, which needs per-row cost profiles and goes stale with seasons, or dynamic work stealing, which is incompatible with the static MPI decomposition PlaSim assumes. Cyclic assignment is balanced in expectation for any season and has a published precedent. The uncertainty is whether the imbalance is really latitude-driven, which DP2.1 tests before any model change.

## 5. Expectations

Baseline: the current default build (`--frontend-opt 0 --decomposition block`) rebuilt into `stats/exoplasim-wasm/speed/`, because earlier reports are not in this checkout. Chrome on the development machine (8 physical cores, 16 threads), fresh Chrome per run, 3 interleaved runs, no profiling.

**Behavioural statistics**
- *Generic assignment call sites* (`_FortranAAssign` in emitted `.ll`, all files): direction down. For the main module, expect a magnitude close to the earlier `-O3` result (360 → ~61). Lower overall if `FRONTEND_O0_FILES` stays empty.
- *Sampled self time in generic assignment* (8-rank T21, 96 steps, `EXOPLASIM_PROFILE=1`): expect it to drop from roughly 12% to under 4%, in line with the call-site reduction. The `pow` share is unchanged or up as a share, since the work is the same and the total is smaller.
- *Barrier share* `barrierMs / rankSimulationMs`, mean over ranks, 8-rank T21 ten days: currently about 19–35% per rank. DP1 alone: roughly unchanged as a share. DP2.2: expect the range to narrow and the mean to fall to about 10–20%. This is uncertain: it assumes most of the spread is latitude-driven, which is exactly what DP2.1 tests.
- *`lastArrivals` distribution:* after DP2.2, expect it closer to uniform (12.5% per rank at 8 ranks).
- *Output differences* against baseline: within the C1 budgets at 2 and 48 steps. Expect around 10⁻¹² K, the same order as the reduction-order differences already seen between rank counts.

**Execution latency** (ten-day wall time, seconds)
- *DP1, T21 8 ranks, 480 steps at 30 min* (baseline about 7.4 s): 5–20% less. The low end is assignment removal alone (12% share, partly offset by remaining calls). The high end adds general `-O2` HLFIR improvements, which have no prior measurement here.
- *DP1, T42 8 ranks, 320 steps at 45 min* (baseline about 19 s): a similar 5–20% reduction, because assignment's share is larger at T42 (15%).
- *DP2.2, on top of DP1, T21 8 ranks:* a further 5–15% reduction. The upper bound is set by the measured barrier spread (1.2 s of 7.4 s is the most that equalizing could recover).
- *Combined `/gcm` page throughput:* T21 about 2 → 2.3–2.9 model days/s, T42 about 0.30 → 0.35–0.45 model days/s. That is directional, derived from the benchmark ranges above, and assumes page overhead stays at its current share.
- *Startup and download:* the Wasm size may change by ±10% with frontend inlining, but load time stays about 50 ms from localhost, so there is no meaningful change.

## 6. Verification

All builds run from the repository root. Never overlap two benchmarks, or a benchmark with an open `/gcm` page.

**Required checks (all FRs)**
- `pnpm lint` and `pnpm typecheck` (TypeScript is not expected to change, but `worker.js`/runner edits and the page must still pass).
- `wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-runtime.py` passes.

**Baseline**
```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --ranks 8 --frontend-opt 0 --decomposition block --output stats/exoplasim-wasm/speed/t21-8-base
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --ranks 8 --truncation 42 --frontend-opt 0 --decomposition block --output stats/exoplasim-wasm/speed/t42-8-base
$env:EXOPLASIM_OUT = 'stats/exoplasim-wasm/speed/t21-8-base'; $env:EXOPLASIM_RUN = 'base'
node scripts/exoplasim-wasm/run-browser.mjs 2
node scripts/exoplasim-wasm/run-browser.mjs 48
node scripts/exoplasim-wasm/run-browser.mjs 480
```
For T42: `EXOPLASIM_OUT=…/t42-8-base`, `EXOPLASIM_MPSTEP=45`, steps 2, 32 and 320.

**FR1 / DP1**
- The build succeeds with `--frontend-opt 2`. `build.json` records `frontendOptimization: 2` and the final `FRONTEND_O0_FILES`.
- The `_FortranAAssign` call-site count across the build directory's `.ll` files is lower than in the baseline build directory. Record both counts.
- C1: `EXOPLASIM_REFERENCE=stats/exoplasim-wasm/speed/t21-8-base`, runs of 2 and 48 steps report all fields finite and within budget. Repeat at T42 (2 and 32 steps, `EXOPLASIM_MPSTEP=45`) against `t42-8-base`.
- Serial native agreement: build `--ranks 1 --frontend-opt 2`, then compare 48 steps against the native reference (`build.py --target native`). Maximum differences stay at the 10⁻¹¹ order recorded in the doc.
- Speed: 3 interleaved baseline/DP1 pairs of the 480-step T21 run and the 320-step T42 run. Accept DP1 if the DP1 median is lower than the baseline median and the slowest DP1 run is faster than the fastest baseline run. Report percentages against the Expectations.
- Profile: `EXOPLASIM_PROFILE=1`, 96 steps, T21 8 ranks, both builds. Record the assignment, `pow`, `gridpointd`, `swr`/`lwr` shares.

**FR2 / DP2**
- DP2.1: the summary from the accepted DP1 ten-day T21 run contains per-rank `busy`, `barrierMs` and `lastArrivals`. Record `max(busy)/mean(busy)` and the gate decision in the doc. If the gate fails, stop here and record why.
- DP2.2 audit list is attached to the change: every hit classified.
- C1: 2-, 48- and 480-step T21 runs and 2- and 32-step T42 runs against the DP1 build (`--decomposition block`) as reference, using `EXOPLASIM_REFERENCE`. All within budget. Also check 2 and 4 ranks at T21 for 48 steps, because the cyclic stride depends on `NPRO`.
- Speed: 3 interleaved DP1-block/DP1-cyclic pairs at T21 and T42 as above. Accept DP2.2 if the cyclic median is lower and the mean barrier share falls. Also check that single-rank compute is unchanged: `--ranks 1` is unaffected by construction, so instead compare the summed `busy` across ranks between block and cyclic. Accept if it is within 3%, which is about 2.5× the run-to-run spread, to rule out a locality penalty.

**Page**
- `pnpm build:gcm-wasm`, then `pnpm dev`, open `/gcm`, and run T21 and T42 with Earth defaults for 30 model days each. The map updates, Speed in the Run panel is higher than the pre-change value recorded the same session from the baseline assets, Pause stops within 100 ms, and Save → Clear → Load restores the saved date and stays paused.

## 7. Documentation updates

`docs/climate/exoplasim-wasm.md` is 220 lines. It mixes the Wasm port and its performance with the `/gcm` page's UI behaviour, and this plan adds two more performance sections to it.

- **Move/split:** move "Chaos Machine `/gcm` page", "Map interaction and settings" and "Asset loading" from `docs/climate/exoplasim-wasm.md` into a new `docs/climate/gcm-page.md`. Leave a two-sentence pointer in `exoplasim-wasm.md`. Update the link in `scripts/exoplasim-wasm/README.md` (it points to the reference doc for design and measurements; add the page doc for page behaviour). The model-module list (`grid`, `boundary`, …) moves with the page section, because it describes `src/model/climate/gcm/`.
- **Edit** `docs/climate/exoplasim-wasm.md`, "Optimization results": add a "Frontend optimization" subsection covering frontend level, `FRONTEND_O0_FILES` with each file's cause, call-site counts, the profile shares before and after, and the interleaved timing tables at T21 and T42. Replace the bullet "Applying Flang frontend `-O3` … produced NaNs" with the isolated cause.
- **Edit** `docs/climate/exoplasim-wasm.md`, "Shared-memory ranks": add a "Latitude decomposition" subsection covering the DP2.1 measurements (per-rank busy, barrier share, `lastArrivals`), the gate outcome, and, if implemented, the cyclic mapping, the `krows` argument, the audit result and the timing tables. Update the sentence about remaining barrier time.
- **Edit** `scripts/exoplasim-wasm/README.md`: add `--frontend-opt` and `--decomposition` to the `build.py` options table.

## 8. Module organization

There are no new TypeScript modules or domains. Gathered snapshots and restart files keep global row order, so `src/model/climate/gcm/` (`runner`, `checkpoint`, `fields`) and `src/ui/gcm/` stay unchanged.

| File | Change | DP |
| --- | --- | --- |
| `scripts/exoplasim-wasm/compile.py` | Read the frontend level from the environment instead of hard-coded `-O0`. Any ABI-repair regex fixes found by DP1.2 go here | DP1.1, DP1.2 |
| `scripts/exoplasim-wasm/build.py` | `--frontend-opt`, `FRONTEND_O0_FILES`, `--decomposition`; pass the per-file level through the environment, as `EXOPLASIM_CODEGEN_FLAGS` already does; record both in `build.json` | DP1.1, DP2.2 |
| `scripts/exoplasim-wasm/library_shm.js` | `lastArrivals` stat; `krows` argument and row permutation in `shm_blocks` (one copy loop shared by scatter and gather paths, no duplicated mapping) | DP2.1, DP2.2 |
| `scripts/exoplasim-wasm/mpimod_shm.f90` | Add `krows` to the `shm_blocks` interface; pass `NLPP` from latitude-structured collectives, `1` elsewhere. Pick `NLPP` or `1` from a single `ROWS` parameter derived from the build's decomposition (`cyclic` → `NLPP`, `block` → `1`), which `build.py` writes the same way it writes `resmod.f90` | DP2.2 |
| `scripts/exoplasim-wasm/build.py` (utilities rewrite regex) | The rewritten `shm_blocks` calls gain the `krows` argument | DP2.2 |
| `scripts/exoplasim-wasm/worker.js`, `run-browser.mjs` | Reorder per-rank `wasm-fields.txt` rows to global order for `cyclic` builds; report per-rank `busy` and `lastArrivals` | DP2.1, DP2.2 |
| `public/gcm/` | Rebuilt with `pnpm build:gcm-wasm` (full rebuild, not `--link-only`, because Fortran and the JS library signature change) | DP1, DP2 |

Dependency direction is unchanged: `build.py` → `compile.py`/`runtime.py`; Fortran `mpimod_shm.f90` → JS `library_shm.js`; the page consumes only built assets.
