# Faster browser GCM

## 1. Objective

Reduce time to advance the browser GCM and reduce display stalls while preserving the current model configuration and diagnostic results. Cover both T21 and T42, the shared-memory worker runtime, snapshot conversion, and the `/gcm` display. Prioritize small changes supported by profiles; deliver and measure each independently.

Constraints:

- Retain double precision, the selected worker count, timestep, radiation interval, boundary data, and seed in every before/after comparison. Keep production defaults unchanged: 45-minute steps, radiation every step, and snapshots every 4 steps. Diagnostic accumulation must receive every published snapshot in order, even when presentation skips intermediate frames.
- Preserve pause/resume, abort propagation, Save/Load, monthly and annual means, Köppen classes, hover values, map navigation, and checkpoint diagnostic history.
- Keep arithmetic and rank reduction order, including intermediate single-precision rounding, unchanged. No fast math, host JavaScript math substitution, frontend optimization-level change, or global SIMD switch in this work.
- Do not run a benchmark alongside another benchmark or a running `/gcm` simulation. Do not overwrite other agents' source changes or generated assets during measurement.
- Exclude a GPU model rewrite, climate retuning, new user-facing performance presets, adaptive worker selection, persistent asset caching, and a compiler/toolchain migration. These need separate evidence and scope.

Evidence reviewed on 2026-10-25:

- [Existing measurements](../docs/climate/exoplasim-wasm.md): bulk fills reduced serial ten-day time from 27.106 s to 20.517 s; 8 ranks reached about 7.4 s at T21. Changing barrier spin budgets did not materially help. T42 double precision took a 32.6 s median for ten days at 30-minute steps. Downscaled drawing previously cost approximately 10% of T21 throughput under shared machine load.
- [Build and runner instructions](../scripts/exoplasim-wasm/README.md), [shared collectives](../scripts/exoplasim-wasm/library_shm.js), [snapshot conversion](../scripts/exoplasim-wasm/library_gcm.js), and the model/UI modules listed in section 8.
- The local manifest contains double-precision T21/T42 builds for 2, 4, and 8 workers. Historical `stats/exoplasim-wasm/` reports are absent in this checkout. The numbers above are historical context, not fresh baseline measurements or promised results.
- Existing UI changes include manual worker selection. Reuse that selection when benchmarking; do not implement it again. Record the source revision and dirty-file diff with each baseline because unrelated work is in progress.

Follow the distinction between requirements and mechanisms and the independence/information axioms described by the [MIT Axiomatic Design Group](https://web.mit.edu/axiom/www/introduction.shtml).

## 2. FRs (Functional Requirements)

- **FR1 — Attribute performance costs reproducibly.** Distinguish loading, model execution, communication, diagnostic handling, and display work for fixed workloads, with repeatable reports and numerical comparisons.
- **FR2 — Advance the same simulation with less worker overhead.** Reduce elapsed execution time without changing model fields, snapshot contents or cadence, or lifecycle behavior.
- **FR3 — Present the same results with less display overhead.** Reduce main-thread work and stalls during live maps and monthly updates without dropping diagnostic samples or changing displayed values.

Numerical correctness and lifecycle behavior are constraints on all FRs, not a separately adjustable accuracy requirement.

## 3. DPs (Design Parameters)

### DP1 → FR1: Separate kernel and application measurements

1. Establish fresh standalone baselines with `scripts/exoplasim-wasm/run-browser.mjs`. Use T21 and T42, 10 layers, precision 8, scalar code generation, bulk assignment, radiation interval 1, and 2/4/8 ranks. Use 30-minute steps for comparison with recorded history and 45-minute steps for the current application configuration.
2. Capture worker profiles separately with the existing `--profile` build flag and `EXOPLASIM_PROFILE=1`. Preserve unprofiled artifacts for timing. Reuse existing `shmStats` counters; extend them with reduction call count, output bytes, and reduction time only in an explicitly enabled diagnostic mode. Do not add per-element timers. Disable the new instrumentation in production and timing runs.
3. Add a focused `scripts/exoplasim-wasm/run-app-browser.mjs` Playwright harness for the production `/gcm` path. The standalone runner uses a classic worker and six final fields; it cannot substitute for the app's ES modules, 18-field publication, Earth boundaries, averaging, and renderer. Drive the actual page and existing controls rather than reproducing the worker protocol or model setup. Provide an opt-in app measurement hook for reading model step, sample count, stage timings, and worker load completion; never expose arrays as React props for instrumentation.
4. Save reports under `stats/exoplasim-wasm/performance/`, recording browser/version, hardware concurrency, actual ranks, viewport, device pixel ratio, source diff, asset hashes, configuration, cache conditions, duration, and errors. Report both total-to-completion time and post-start steady throughput. Instrumented traces explain costs; uninstrumented pairs decide timing.

Measurement constants and reasoning:

| Value | Reason/source |
| --- | --- |
| 480 steps at 30 minutes; 320 at 45 minutes | Both advance 10 model days; matches the existing ten-day comparison window in the reference doc. |
| 3 interleaved baseline/candidate pairs | Reuses the documented optimization protocol; limits machine-load drift while exposing run variability. Report individual samples and median paired ratio. |
| 2-step and 1-day correctness runs: 48 steps at 30 minutes, 32 at 45 minutes | Existing smoke-check approach; catches immediate corruption and short trajectory divergence before timing. |
| 2/4/8 ranks, T21/T42, 10 layers, 8-byte reals | Existing manifest and build configuration; no new production variants. |
| Barrier spin 20,000; publication every 4 steps; background notification 100 ms | Existing `runner/index.ts`, `useGcmRun.ts`, and `live-store.ts`; retain them to isolate overhead changes. |
| App viewport 1440 × 900 CSS pixels, device scale factor 1 | Fixed desktop geometry for reproducibility; test device scale factor 2 separately to expose raster scaling costs. This is a harness choice, not a UI constraint. |
| App steady window 60 s after the first snapshot | Covers many publications even at T42 while bounding each interactive trial; elapsed startup is recorded separately. |
| Benchmark timeout 10 minutes | Existing runner default; sufficient for the ten-day cases in the historical measurements. |

### DP2 → FR2: Remove avoidable worker allocations and copies

Implement in this order, comparing each independently:

1. **Write reductions directly into the destination Wasm heap.** `SHM.sum` currently allocates a result typed array, creates source views per rank, and returns a byte view that the caller copies into Wasm. Replace that temporary-result path with a shared private reduction operation used by both `shm_reduce` and `shm_reduce_scatter`. Initialize the destination from rank 0 and add ranks in their existing ascending order. For precision 4, store each addition through the Float32 destination, preserving current rounding after every rank. Keep `Math.max` behavior, signed zero, strides, root-only/all-rank modes, and alias safety: contributions are copied into shared exchange memory before overwriting any Wasm destination. Reacquire Wasm heap views after memory growth; do not cache detached views.
2. **Convert published double fields directly into the outgoing Float32 buffer.** `library_gcm.js` currently slices the entire double payload before converting it. Read an aligned Float64 heap view and construct the owned Float32 publication buffer directly. Retain a copy for precision 4 because transferring a view of Wasm memory is not permitted by this ownership design. Preserve the transferred-buffer protocol in `runner/gcm.worker.ts` and validate all 18 fields.

Retain alternating exchange regions, barriers, abort checks, and the stop broadcast. Do not batch or remove collectives without a separate dependency proof. Do not introduce snapshot buffer pooling: transferred ownership and asynchronous diagnostic readers make lifetime management more complex than these copy removals.

No new production numeric tuning parameters are needed. Element sizes remain 4/8 bytes, the existing precision modes. Published values remain Float32, as in the current implementation.

### DP3 → FR3: Avoid redundant presentation work

1. Reuse the existing animation-frame notification coalescing, selected-layer memoization, precomputed interpolation corners/weights, and raster cache. They already exist; do not add a second scheduler or interpolate every field eagerly.
2. Fuse the final lapse-corrected temperature calculation into the existing interpolation traversal, eliminating full-resolution temporary buffers. Preserve intermediate Float32 rounding explicitly with `Math.fround` wherever the old code wrote an intermediate typed array. Keep `GCM_DOWNSCALE.temperature`'s public API and validate its output against the original algorithm. Reuse the private interpolation operation from `interpolate` and `temperature`, which are two genuine callers.
3. Cache the coastline overlay for the current coastline identity, viewport, canvas dimensions, and device pixel ratio, so field-only snapshots composite existing coastlines instead of retracing every ring. Own the cache in the map instance and release it on disposal. Pan, zoom, resize, and coastline changes invalidate it. Keep the existing raster cache and dateline clipping logic; no new geometric approximation or color lookup quantization.
4. If the fresh profile shows monthly downscaled Köppen computation causing long tasks, move that existing computation to a dedicated presentation worker. Use the existing `GCM_DOWNSCALE.koppen` API rather than duplicating climate rules. Retain only the latest pending request and discard stale results by run generation and monthly-data identity. Copy the worker-owned monthly inputs; never transfer arrays still used by averages or checkpoints. Keep the last valid displayed result until the current result arrives. This is conditional on an observed long task, not a mandatory worker framework.

The conditional worker uses **1 executing request and 1 replaceable pending request**, a bounded queue justified by the fact that the UI only displays the latest selected monthly set. No diagnostic snapshots are discarded. Long tasks mean tasks over **50 ms**, used here as a documented engineering threshold to identify visible blocking, not a climate tolerance. Do not introduce a new display throttle or change the 4-step diagnostic sampling interval.

## 4. Matrix

| Requirement | DP1 measurement | DP2 worker overhead | DP3 presentation |
| --- | --- | --- | --- |
| FR1 attribution | X | — | — |
| FR2 worker execution | X | X | — |
| FR3 display overhead | X | X | X |

This is lower triangular under the sequence **DP1 → DP2 → DP3**. Measurement hooks can perturb both execution and presentation, hence the DP1 cross-effects; measure their overhead and disable them for final timing. Faster workers change snapshot arrival pressure, hence DP2 affects FR3. FR2 is measured in the standalone workload, so presentation changes do not affect its controlled measurement. Overall `/gcm` throughput still reflects shared CPU contention; repeat application validation after every change rather than claiming physical independence between worker and UI threads.

The Information Axiom favors removal of observed copies and allocations over new synchronization, approximations, or compiler flags. The source demonstrates those copies exist; profiles must establish their cost. Existing evidence argues against spin tuning, blanket SIMD/-O3, or host math. A presentation worker adds ownership and lifecycle risk, so use it only if synchronous monthly work remains a measured bottleneck. No numerical probability of success is supported by the available evidence.

## 5. Expectations

Estimates describe likely behavior, not acceptance gates or new tuning constants.

| Metric/workload | Baseline | Expected change and uncertainty |
| --- | --- | --- |
| Standalone elapsed s / 10 model days, T21/T42 precision 8 at fixed ranks and timestep | Fresh DP1 baseline; historical T21 8-rank ≈7.4 s and T42 8-rank 30-minute median 32.6 s | Downward from direct reductions. No defensible percentage until fresh reduction self-time is measured; these changes cannot remove time in Fortran physics or waiting for slower ranks. |
| Reduction result allocation bytes/call | `count × elementBytes`, plus view objects | Eliminate the temporary result payload and final result copy; source views may still be created. Total GC impact depends on call frequency. |
| Double snapshot temporary bytes/publication | 18 × points × 8 | Remove 294,912 bytes at T21 (2,048 points) or 1,179,648 bytes at T42 (8,192 points). Keep outgoing 147,456 / 589,824-byte Float32 payloads. Derived from the existing 18-field layout, not a measured speedup. |
| Downscaled temperature temporary allocation, 720 × 360 display | Current interpolated temperature, interpolated lapse, and final temperature arrays | Reduce full-resolution temporaries through fusion while keeping rounding; allocation decreases, but speed depends on interpolation and color/paint share. |
| Coastline CPU ms/field frame at fixed viewport | Fresh production trace | Geometry traversal becomes a cached overlay composite. Pan/zoom frames still rebuild it; benefit depends on coastline complexity and DPR. |
| App model days/s and main-thread task p95 ms, model vs downscaled maps | Fresh 60 s trials | Recover some display-related throughput and reduce stalls. The historical ≈10% downscale penalty is context only: hardware load and current rendering differ. Do not add independent stage estimates into a promised overall speedup. |
| Cold/warm startup ms and peak memory bytes | Fresh app trials | Startup may stay similar; no download optimization is planned. A viewport-sized overlay adds RGBA storage proportional to canvas area. Conditional worker monthly copies increase memory, so report their peak separately. |

Behavioral statistics: unchanged publication steps, all 18 snapshot arrays, monthly sample counts/sums, annual means, global means, yearly balance records, and Köppen class IDs for identical inputs. This is trajectory-preserving work, not a claim that short checks validate equilibrium climate. Compare observed performance with the expectations above and explain discrepancies.

## 6. Verification

### Baseline protocol and exact standalone configurations

Before building, confirm no other benchmark or `/gcm` simulation is active. Save source/build provenance. Build baseline artifacts before edits, then candidate artifacts into different output paths. A full rebuild is required after any Fortran, `library_shm.js`, or `library_gcm.js` change; never use `--link-only` for these changes. Follow `scripts/exoplasim-wasm/README.md` for WSL toolchain setup.

For each combination `T = 21,42` and `R = 2,4,8`, use output directories `stats/exoplasim-wasm/performance/baseline/tT-rR` and `stats/exoplasim-wasm/performance/candidate/tT-rR`, substituting the numeric values. Example for T42/8:

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --truncation 42 --ranks 8 --precision 8 --variant scalar --assignment bulk --output stats/exoplasim-wasm/performance/baseline/t42-r8
# After source changes, build the candidate with the same flags into candidate/t42-r8.
$env:EXOPLASIM_OUT = 'stats/exoplasim-wasm/performance/baseline/t42-r8'
$env:EXOPLASIM_REFERENCE = $env:EXOPLASIM_OUT
$env:EXOPLASIM_MPSTEP = '30'
$env:EXOPLASIM_NRADINT = '1'
$env:EXOPLASIM_SPIN = '20000'
$env:EXOPLASIM_TIMEOUT_MINUTES = '10'
Remove-Item Env:EXOPLASIM_PROFILE -ErrorAction SilentlyContinue
node scripts/exoplasim-wasm/run-browser.mjs 480
```

Run the baseline once without `EXOPLASIM_RUN` so the existing comparator can read `browser-480.json`. For candidate timings set `EXOPLASIM_OUT` to the candidate directory, `EXOPLASIM_REFERENCE` to the matching baseline directory, and labels `pair1`, `pair2`, `pair3`. Alternate baseline/candidate runs, labelling baseline repeats too. The reference reader ignores run labels, so retain the canonical unlabelled reference report. For 45 minutes, use separate `baseline45`/`candidate45` paths and 320 steps; never overwrite a 30-minute reference with a 45-minute run. Correctness references likewise use their own matching step/configuration reports.

Profile only T21/8 and T42/8 initially, in separate `profile/t21-r8` and `profile/t42-r8` builds with `--profile`; use `EXOPLASIM_PROFILE=1`, 96 steps at 30 minutes, and no timing conclusions from those traces. The two-day profile window follows the reference doc's hotspot investigations. Restore profiling off before timing.

### FR checks and acceptance

| FR | Checks | Acceptance |
| --- | --- | --- |
| FR1 | Existing runner, separate app harness, stage traces and provenance; 3 paired timing runs for each standalone configuration | Correct grid, requested final step, finite fields, successful exit, no browser errors; reports distinguish startup, kernel and app metrics. Retain all repeats, not just favorable samples. |
| FR2 | Focused synthetic collective checks plus 2-step, 1-day, and ten-day comparisons at both resolutions and every listed rank count; precision-4 synthetic/short regression too | Exact same-rank browser field equality for arithmetic-preserving changes. Existing cross-toolchain tolerances remain 10⁻⁶ K, 10⁻⁶ m/s, 10⁻⁴ Pa, 10⁻¹⁰ humidity from `run-browser.mjs`; these do not relax the exact browser-to-browser requirement. Accept a worker optimization only when all 3 primary T21/8 and T42/8 timing pairs improve and other configurations' median changes stay within their observed baseline repeat spread; otherwise investigate or omit it. |
| FR3 | Production app trials, deterministic downscale fixture comparisons, same-viewport pixel comparisons, monthly-boundary and lifecycle exercises | Same converted snapshots and diagnostics, exact interpolated Float32 values/classes, same hover samples and raster pixels on the same browser/DPR. Presentation work decreases in targeted traces; app throughput must not regress beyond observed baseline variability. |

Collective regression cases must include sum/max, root/all modes, reduce-scatter levels and strides, both precisions, input/output aliasing, signed zero, special-value max behavior, memory growth, alternating exchange reuse with a delayed rank, and abort wakeup. Put these in a small browser check using the actual linked JS library with synthetic Wasm heaps; do not maintain a duplicate reduction implementation for tests.

Validate all 18 converted app fields on synthetic and live fixtures; the standalone runner's six fields alone cannot establish snapshot equivalence. Compare `GCM_AVERAGES` accumulation and checkpoint round-trip from the same captured snapshot sequence. Exercise a complete 12-month fixture for annual/Köppen behavior rather than requiring a year-long simulation for a presentation-only optimization.

The proposed app harness runs with `pnpm build` and `pnpm preview --host 127.0.0.1`; default harness URL is `http://127.0.0.1:4173/gcm`. Run `node scripts/exoplasim-wasm/run-app-browser.mjs` sequentially for T21/T42 and 2/4/8 workers, model-grid and downscaled temperature views, using `GCM.DEFAULT_CONFIG` with only resolution and rank choice varied. Save paired reports under `stats/exoplasim-wasm/performance/app/`. The harness must provide explicit CLI options for those selections and report the effective values. Repeat the primary 8-worker cases in 3 interleaved pairs; exercise wind, monthly, annual, Köppen, and DPR 2 as focused display checks. Check cold and warm cache startup separately; do not include cache clearing in steady throughput measurements.

For each app variant: Pause/Resume, Save while running and paused, Clear, Load paused, and Resume. Confirm the worker actually stops advancing after pause acknowledgement; the displayed status alone is insufficient. After pausing, the view must drain within the existing 100 ms notification bound plus any in-flight render duration. Conditional presentation-worker results must never apply after Clear/Load or overwrite newer requests. No lost or duplicated diagnostic samples at month boundaries.

Run `pnpm lint` and `pnpm typecheck` before finishing any TS/TSX implementation; review lint's mutations because this repository's lint command writes fixes. Run `pnpm build` for the app harness. If the Fortran runtime itself changes, additionally run `wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-runtime.py`; DP2 as designed does not require a runtime patch. Run `pnpm build:gcm-wasm` without `--link-only` for final app verification after DP2, coordinated with other agents using those assets.

Do not implement a speculative follow-on if the measured candidates do not improve performance. Report rejected candidates and remaining hotspots. Archive this plan only after the selected changes, verification, and documentation are complete.

## 7. Documentation updates

The existing `docs/climate/exoplasim-wasm.md` mixes build history, performance, numerical experiments, and application behavior. Avoid extending that mixed document indefinitely.

- **Edit** `docs/climate/exoplasim-wasm.md`: retain its overview and essential historical baseline tables; record concise new measured before/after results here, including report paths, hardware/configuration, exactness checks, and rejected candidates. Link to the two focused references below so new measurements remain discoverable at the required existing path.
- **Move/split** detailed benchmark protocol and optimization methodology from `docs/climate/exoplasim-wasm.md` into **create** `docs/climate/exoplasim-performance.md`: distinguish kernel/app timings, profiling overhead, paired-run protocol, new reduction/publication changes, and known limitations. Keep historical summaries in the overview rather than copying entire histories into both documents.
- **Move/split** `/gcm` application sections (configuration, modules, checkpoints, display, map interaction, asset loading) into **create** `docs/climate/exoplasim-browser.md`: add display cache invalidation, ownership, and conditional worker behavior if implemented. Retain numerical-experiment results in the overview/performance material rather than mixing them into UI instructions.
- **Edit** `scripts/exoplasim-wasm/README.md`: add the app harness invocation/options and a link to the performance reference; preserve the full-rebuild warning and clarify that JS shared-memory/snapshot library changes also require full recompilation.
- **Edit** `README.md`: update existing GCM documentation links where the split changes their destination, merging around current edits. Update the overview's cross-links and the scripts README's detailed links. Search for links to moved headings and repoint every affected reference; do not duplicate moved explanations.

No new measurements are claimed by this planning-only change.

## 8. Module organization

| DP | Files and responsibility |
| --- | --- |
| DP1 | Extend `scripts/exoplasim-wasm/run-browser.mjs` / `worker.js` only where existing reports lack the required metadata. Add `scripts/exoplasim-wasm/run-app-browser.mjs` for actual-page orchestration. Keep browser benchmark code outside model domains. |
| DP1 | App measurement types and opt-in adapter belong in `src/ui/gcm/performance/{index.ts,types.ts}`, exporting only `GCM_PERFORMANCE`; hooks/components call the adapter, whose disabled path does no timing. Worker-side diagnostics stay in the existing runner types and shared-memory diagnostic mode. No general metrics framework. |
| DP2 | `scripts/exoplasim-wasm/library_shm.js`: one private destination-writing reduction operation, called by both reductions. Preserve the Fortran ABI in `mpimod_shm.f90`. `library_gcm.js`: direct snapshot conversion. `gcm_publish.f90` and its cadence remain unchanged. |
| DP2 | `src/model/climate/gcm/runner/{index.ts,types.ts,gcm.worker.ts}`: retain `GCM_RUNNER`, current transfers, control buffer and lifecycle; update types only if opt-in measurements require it. Tests import no private namespace methods. |
| DP3 | `src/model/climate/gcm/downscale/{index.ts,types.ts}`: retain `GCM_DOWNSCALE`, share private interpolation logic between real callers, preserve shape/behavior separation. No generic utility extraction. |
| DP3 | `src/ui/gcm/field-map.ts`, `GcmMap.tsx`, and `types.ts`: per-map overlay ownership, invalidation and disposal; reuse existing painter and navigation callbacks. Existing UI runtime modules remain concrete imports, not pass-through re-exports. |
| Conditional DP3 | `src/ui/gcm/presentation/{index.ts,types.ts,presentation.worker.ts}` exports only `GCM_PRESENTATION` for bounded request lifecycle. It depends on `GCM_DOWNSCALE` and concrete model types; model modules never depend on UI. `GcmView.tsx` consumes results; climate logic stays in the model. |

Reuse `GCM_FIELDS`, `GCM_AVERAGES`, `GCM_GRID`, `GCM_DOWNSCALE`, `GCM_LIVE`, and `GCM_FIELD_SAMPLE` rather than duplicating field layouts, monthly accumulation, interpolation, notification, or geographic sampling. Add new types to the owning `types.ts`; functions take one object argument where they need multiple inputs. Do not add classes, enums, re-export shims, or new compatibility branches. Use the required repository refactor scripts for any exported-symbol or module moves; no such source moves are needed for the core optimization.
