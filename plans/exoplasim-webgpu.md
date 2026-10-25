# ExoPlaSim on WebGPU

## 1. Objective

**Problem.** `/gcm` runs ExoPlaSim as Fortran compiled to Wasm, split across up to 8 shared-memory Web Workers. Recorded throughput (`docs/climate/exoplasim-wasm.md`) is about 2 model days/s at T21 and 0.30 model days/s at T42. A T42 year takes 11–20 minutes, and `balance` needs at least 14 model years before it can judge equilibrium. The remaining CPU levers are small: frontend `-O2` gave 10.5%, barrier waits are 18–20% of rank time, and SIMD was slower. The development machine's GPU (NVIDIA GeForce RTX 2070 SUPER, about 9 TFLOP/s f32) does nothing while the model runs.

**Intended outcome.** The whole time integration of ExoPlaSim runs as WebGPU compute shaders on one device: spectral transforms, dynamical core, every physics and surface component the page can reach, and global reductions. The Wasm engine, its Fortran-to-Wasm toolchain and the shared-memory ranks are removed from the page. The page keeps its features: live maps, monthly and annual means, Köppen, balance, Pause/Resume, Save/Load, and custom terrain.

**What "entire model" means here.** Every Fortran statement that executes inside the time-step loop for any configuration the `/gcm` panel can produce. DP3/DP4 make this list mechanically with `gcov` (Verification V1). Two kinds of CPU work stay in TypeScript, both on purpose:
- **One-time setup**, in f64: reading namelists and `.sra` files, Gaussian quadrature, Legendre tables, semi-implicit matrix inversion and the initial noise kick. These are I/O or need f64 that WGSL lacks. They run once and are uploaded.
- **Per-step quantities that depend only on time**: calendar date, orbital position, solar declination and the choice of which periodic kernels run on a step. These are computed in f64 and written as step parameters.

No model state is read back to the CPU or computed there during integration, except snapshot publication and the stability flag (DP5).

**Constraints.**
- **C1 (climate fidelity).** The GPU model's 20-year climate statistics must match a double-precision reference within interannual noise (V5). Bitwise or trajectory agreement is impossible: WGSL has no `f64` type, and GPU evaluation order differs from Fortran's.
- **C2 (same inputs).** The GPU model reads the same namelist text and `.sra` files the Fortran reference reads. Both get them from the existing `namelist` and `boundary` modules, so the two engines can't disagree about configuration.
- **C3 (no compatibility).** Checkpoint formats ≤ 3, the Wasm assets, the rank selector and cross-origin isolation for shared memory are removed outright. No fallback engine is kept for browsers without WebGPU. The page shows that WebGPU is required.

**Scope.** New GPU model modules under `src/model/climate/gcm/`. Edits to `runner`, `checkpoint`, `boundary` and the `/gcm` UI. A Fortran *reference* toolchain (native builds, coverage, probes), adapted from `scripts/exoplasim-wasm/`. Removal of the Wasm path. Documentation.

**Exclusions.**
- New resolutions (T63 and up), more levels and new physics. The design does not block them; only T21 and T42 at 10 levels are built and verified.
- Code paths the panel can't reach, which keep their Fortran defaults: semi-Lagrangian tracer advection (`tpcore.f90`, `trc_routines.f90`, `tracermod.f90`; `NQSPEC = 1`), aerosols (`aeromod.f90`, `aerocore.f90`; `L_AERO = 0`), LSG ocean coupling (`cpl_stub`, `lsgmod` stubs), file output (`outmod.f90`; `NOUTPUT = 0`), GUI (`guimod_stub`), storm diagnostics (`hurricanemod.f90`; `NSTORMDIAG = 0`, `HC_CAPTURE = 0`), and the `nprint == 2` debug gathers in `rainmod.f90`. V1 confirms each one is unreached. If V1 finds one reached, it moves into scope.
- Moving the page's diagnostics (`averages`, `balance`, `downscale`, Köppen) onto the GPU. They consume snapshots and are not part of the model. If V7 finds they limit page throughput, that gets its own plan.
- Bit-reproducibility across GPU vendors. Results are deterministic on one device and driver (DP2.4), not across devices.
- The two Wasm speed plans (`plans/gcm-speed.md`, `plans/web-gcm-performance.md`). This plan makes them obsolete; archiving or deleting them is the user's call.

## 2. FRs (Functional Requirements)

- **FR1 — Sufficient precision.** An ExoPlaSim integration using only the arithmetic WebGPU offers reproduces the double-precision climate within interannual noise.
- **FR2 — Device residency.** During integration all model state lives on the GPU and advances without CPU computation on it. The CPU only supplies time-only step parameters and receives published snapshots.
- **FR3 — Spectral dynamics on the GPU.** Spectral transforms and the adiabatic dynamical core match the reference, given identical inputs.
- **FR4 — Physics and surface on the GPU.** Every reachable physics and surface computation matches the reference, given identical inputs.
- **FR5 — Run control and output.** The page receives every snapshot in order. Pause takes effect within 100 ms. Save/Load restores a run exactly. Device loss and instability are reported.
- **FR6 — Throughput.** Model days per wall-clock second are higher than the 8-rank Wasm engine's at T21 and T42.
- **FR7 — Single engine.** The repository builds, serves and documents only the WebGPU engine for `/gcm`. Fortran remains only as the verification reference.

## 3. DPs (Design Parameters)

### DP1 — Precision policy chosen by a Fortran f32 gate (→ FR1)

- **DP1.1 — f32 reference build.** Native gfortran build with default 4-byte reals and `-freal-8-real-4`, so the explicit `real(kind=8)` variables (for example `sid`, `gwd` in `plasim.f90`) are also demoted. That leaves no f64 anywhere, which is what WGSL offers. Flang has no demotion flag, so the reference uses gfortran, as the 8-rank OpenMPI native runs in the doc already do. Paired with an otherwise identical f64 build (`-fdefault-real-8 -fdefault-double-8`). Both use `-cpp`, because without it `carbonmod.f90`'s `#define` branches are wrong (doc, "Shared-memory ranks").
- **DP1.2 — Gate run.** Both builds integrate the page's Earth default inputs (C2) at 45-minute steps for 15 years at T21, 8 MPI ranks. V2 compares them. The T42 gate (15 years, same rule) runs before P3 starts, so that physics kernels are not committed to f32 at T42 without it.
  - *Value 15 years, 5 discarded:* `balance` needs 14 years to judge, so 15 is the shortest run that still produces a verdict. Discarding 5 years of slab-ocean spin-up leaves N = 10 annual means. The f64 series shows whether 5 years is enough: if years 4–5 still drift by more than 2σ√(2/N), V2 reports it and the comparison window moves later. Measured cost: 114 s per T21 year at 8 ranks (P0 smoke run), so about 30 minutes per precision. The user chose this over 30 years (about 1 hour per precision) on 2026-10-25.
- **DP1.3 — Outcome rule.** If f32 passes V2, the GPU uses f32 storage and arithmetic throughout, with fixed-order tree reductions (DP2.4). If it fails, restore `real(kind=8)` one module at a time in the f32 build, bisecting over the ~25 reachable modules (⌈log₂ 25⌉ = 5 rounds per culprit) until V2 passes. Only the variables in those modules get double-float (`df64`: an unevaluated f32 pair) on the GPU, through `src/model/shared/gpu/df64.wgsl`.
  - *df64 algorithms and cost:* Dekker two-sum and two-product using WGSL's `fma` built-in. Thall, "Extended-Precision Floating-Point Numbers for GPU Computation" (2006), reports roughly 10–20 f32 operations per df64 operation, so it is applied only where the gate requires it. `df64.wgsl` is only created if DP1.3 needs it.
- **DP1.4 — Constant tables.** Gaussian latitudes and weights, Legendre polynomials, and the semi-implicit matrices are computed in f64 in TypeScript, then rounded once to f32 (or split to df64 if DP1.3 names them). They are stored as tables. Rounding a constant once costs at most 2⁻²⁴ relative error, while computing it in f32 compounds recurrence error (Legendre recurrences lose accuracy with degree).

### DP2 — One arena, a field registry and a step encoder (→ FR2)

- **DP2.1 — Arena.** All model state is one `GPUBuffer` (`STORAGE | COPY_SRC | COPY_DST`) holding struct-of-arrays fields at fixed offsets. Constant tables go in a second read-only buffer, and step parameters in a third. A kernel binds 3 storage buffers.
  - *Why one arena:* WebGPU's default `maxStorageBuffersPerShaderStage` is 8 (WebGPU spec, default limits). PlaSim routines touch dozens of fields (`fluxmod` reads and writes more than 30), so one binding per field doesn't fit.
  - *Size bound:* the default `maxStorageBufferBindingSize` is 134,217,728 bytes. The registry sums field sizes at startup and requests the adapter's limit when that sum is larger. If the adapter is also too small, startup fails and names the size. The T42 estimate is 60 MB or less: about 150 3-D fields × 8192 × 10 × 4 B is 49 MB, about 300 2-D fields is 10 MB, and spectral data is under 1 MB. V3 records the measured size.
- **DP2.2 — Field registry.** A TypeScript list of fields: name, the Fortran array it mirrors (for probes), shape (spectral, gridpoint 2-D, gridpoint 3-D, scalar) and whether it is *prognostic* (needed to restart). The prognostic flags mirror `restartmod.f90`'s restart list. The registry generates a WGSL header of `const` offsets and sizes, prepended to every kernel, so TS and WGSL can't disagree on layout. Gridpoint order is PlaSim's serial order: longitude fastest, rows north to south. That is also the existing snapshot order.
- **DP2.3 — Step encoder.** One function encodes one model step as compute dispatches, in the order of `master` in `plasim.f90`: `gridpointa`, `spectrala`, `gridpointd` with its sub-steps, `spectrald`. The `nkits = 3` initial short steps follow the same branch as `master`. NRADINT and other periodic calls (annual glacier update, carbon `FREQUENCY`) are decided on the CPU from the step index alone.
- **DP2.4 — Global reductions on the GPU.** Mass fixer (`miscmod` `fixer`), carbon weathering sums, energy and water diagnostics, and the stability check use one shared deterministic tree-reduction kernel. It does a fixed-order workgroup sum, then a single-workgroup final pass, with no atomics (WGSL has no float atomics anyway). Its result stays in the arena for the kernels that use it, such as CO₂ for radiation.
  - *Accuracy:* pairwise summation's error bound is γ₍⌈log₂ n⌉₎, against γₙ for recursive summation (Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed., §4.2). For T42's n = 8192, the worst-case relative error is about 13 u = 7.7 × 10⁻⁷ instead of about 4.9 × 10⁻⁴.
- **DP2.5 — Step parameters.** Per step, TypeScript computes date, solar declination, eccentricity factor and orbit in f64. This ports `calmod.f90` and `radmod.f90`'s `orb_params` / `orb_decl` / `gen_orb_decl`, which depend only on time and namelist values. It writes the whole batch's parameters in one `writeBuffer` before submitting. A kernel indexes its step's entry with a per-step dynamic offset.

### DP3 — Spectral transforms and dynamical core (→ FR3)

- **DP3.1 — Fourier transform as a truncated DFT.** Only zonal wavenumbers m ≤ NTRU survive truncation. The forward transform therefore computes 2(NTRU+1) real outputs per row as a dot product with a precomputed cos/sin table: NLON × 2(NTRU+1) = 64 × 44 at T21, 128 × 86 at T42. The inverse uses the transpose. Each workgroup handles one row (latitude × level × field) and sums with a tree in workgroup memory.
  - *Why not an FFT:* the work is about 11k multiply-adds per row at T42. With about 6,400 rows per transform set that is about 0.14 GFLOP per step, around 0.1 ms on this GPU at 15% efficiency. A truncated DFT is one kernel shape with no radix logic. It sidesteps the `dfft8(a,a,…)` aliasing that forced `fftmod.f90` to `-O0`. Tree summation gives log₂ NLON = 7 levels of error growth, the same order as a radix-2 FFT. Workgroup memory per row (128 × 4 B = 512 B) stays far below the 16,384 B default `maxComputeWorkgroupStorageSize`.
- **DP3.2 — Legendre transforms.** Ports `legmod.f90` (`fc2sp`, `sp2fc`, `sp2fcdmu`, `dv2uv`, `uv2dv`, `qtend`, `mktend`, `sp2fl`, `invlega`, `invlegd`). It keeps PlaSim's even/odd hemispheric split, so it sums over NLAT/2 latitude pairs. Forward transforms use one thread per (spectral coefficient, level, field) and sum over latitudes with the polynomial-times-weight tables from DP1.4. Inverse transforms use one thread per (m, latitude pair, level, field) and sum over n. Partial sums across latitudes are accumulated in a fixed order, so results don't change from run to run.
- **DP3.3 — Dynamics.** Ports `gridpointa`, `calcgp`, `spectrala`, `spectrald`, `mksecond` and `mkdheat`. Gridpoint parts run one thread per point. Spectral parts run one thread per (coefficient, level). The semi-implicit solve applies the per-degree NLEV × NLEV inverse matrices (`initsi`, `makebm`, `minvers`, inverted in f64 at setup per DP1.4) as one matrix-vector product per (coefficient, n). Horizontal diffusion and the Robert–Asselin time filter are element-wise with precomputed factors.
- **DP3.4 — Setup.** TypeScript ports of `prolog`, `readnl`, `initpm`, `initsi`, `legini`, `inilat`, `initfd`, `setzt`, `noise` (`KICK = 1`) and the physics `*ini` routines produce the tables and the initial arena. `noise` uses `src/model/shared/random/rng`, seeded from the namelist `SEED`. Fortran's `random_number` stream can't be reproduced, so verification starts the GPU from reference state dumps (V3) rather than from its own kick.

### DP4 — Physics and surface kernels, scoped by coverage (→ FR4)

- **DP4.1 — Scope.** V1 produces the list of executed lines per routine for the configuration matrix. Each routine with executed lines inside the time-step loop gets a WGSL port of exactly those branches. Branches that never execute get no WGSL, and a comment names the switch value that rules them out. Expected modules: `miscmod` (fixer), `fluxmod` (surface fluxes, stress, vertical diffusion), `radmod` (`solang`, `mko3`, `swr`, `lwr`, and the NRADINT cache from `build.py`), `rainmod` (`mkdqtgp`, `mklsp`, `kuo`, `mkshallow`, `mkclouds`, `mkdca`, `mkrain`), `surfmod`, `landmod`, `seamod`, `icemod`, `oceanmod` (slab ocean, `NOCEAN = 1`), `simba` (vegetation), `carbonmod` (`NCARBON = 1`), `glaciermod` (when the panel enables glaciers), `specblock` (snow spectral albedo table, a constant), plus the stability check.
- **DP4.2 — Thread mapping.** One thread per grid column, looping over the 10 levels in private arrays. Each Fortran `*step` routine is one kernel. A step routine splits into several kernels only where it calls a global reduction (DP2.4) or a spectral transform (DP3). `lwr`'s level-pair arrays (NLEV² = 100 floats) are private per thread.
  - *Workgroup size 64:* a multiple of NVIDIA's 32-wide warps and AMD's 64-wide wavefronts, and within the 256 default `maxComputeInvocationsPerWorkgroup`. Level-parallel mappings were rejected: 10 levels give at most 10 threads of parallelism per column, and the level loops in convection and radiation are sequential recurrences.
- **DP4.3 — Math functions.** WGSL built-ins (`exp`, `log`, `pow`, `sqrt`) are used first. The WGSL spec defines `pow` as inherited from `exp2(y·log2(x))`, with `exp2` accurate to 3 + 2|x| ULP. If a kernel fails V3 because of them, an accurate replacement goes in `src/model/shared/gpu/math.wgsl`. That module is only created once two kernels need it.
- **DP4.4 — Random numbers.** Physics randomness (`rainmod` `get_random_root` when `nstorain > 0`, if V1 reaches it) uses counter-based Philox4x32-10 (Salmon et al., "Parallel Random Numbers: As Easy as 1, 2, 3", SC'11), keyed by (seed, step, column). It is stateless and reproducible on one device, and needs no stored generator state in checkpoints. V3 compares these kernels by distribution (V3, stochastic rule), since the streams differ.

### DP5 — Batching, snapshots, control and checkpoints (→ FR5)

- **DP5.1 — Worker host.** One module worker owns the `GPUDevice`. WebGPU is available in dedicated workers in Chrome, Edge, Firefox 141+ and Safari 26. Control (start, pause, resume, save, clear) arrives by `postMessage`. No `SharedArrayBuffer` remains.
- **DP5.2 — Batch size from a GPU-time budget.** A batch is a whole number of snapshot intervals (`publishEvery` steps). The next batch's interval count is `max(1, floor(25 ms × n_k / t_k))`, where `t_k` is the previous batch's measured submit-to-`onSubmittedWorkDone` time and `n_k` its interval count. At most 2 batches are in flight. Pause stops submitting, so at most 50 ms of GPU work is queued when it is pressed.
  - *Value 25 ms × 2:* the doc's accepted behaviour is that the date stops within 100 ms of Pause. 50 ms of queued work, plus one 16.7 ms frame to deliver the last snapshot, stays under 100 ms with a 33 ms margin. Two in flight is the minimum that keeps the GPU busy while the CPU encodes the next batch.
- **DP5.3 — Snapshots.** A pack kernel computes `gcm_publish.f90`'s 18 surface fields from the arena with the same formulas (including net TOA `dswfl(:,1) + dlwfl(:,1)` and `hfns`). It runs every `publishEvery` steps into the batch's slot in a snapshot buffer. After each batch it is copied into one of 3 staging buffers (`MAP_READ`), mapped with `mapAsync`, and posted in step order with the existing `snapshot` message shape. The stability flag (DP2.4) travels in the same slot. A set flag stops the run and reports the step.
  - *Value 3 staging buffers:* triple buffering. One is being filled by the GPU, one is mapped and read by the worker, and one is free, so mapping never blocks the next batch.
- **DP5.4 — Checkpoint format 4.** Keeps format 3's magic line, JSON header (config, date, step, terrain, diagnostics metadata) and diagnostic-array block. The Fortran `plasim_status` restart file is replaced by the arena's prognostic fields (DP2.2), copied out as raw f32 (or df64 pairs) with a field-name/offset index in the header. Load validates the index against the current registry and rejects any mismatch. Formats ≤ 3 are rejected (C3).
- **DP5.5 — Device loss.** `device.lost` and uncaptured validation errors stop the run and report the reason and last published date. There is no automatic recovery; the user can Load a checkpoint.

### DP6 — Throughput mechanisms (→ FR6)

- **DP6.1 — Pipelines created at setup** with `createComputePipelineAsync`, never during stepping.
- **DP6.2 — One compute pass per batch.** Every dispatch of every step in the batch is recorded in one `GPUComputePassEncoder`, with bind groups created once, because the arena never changes. WebGPU orders dispatches within a pass by usage scope. That leaves per-dispatch cost as the main overhead, which V7 measures.
- **DP6.3 — Fuse a routine's work into one kernel** (DP4.2). Splits happen only at reductions and transforms. The expected count is 45–60 dispatches per step: about 10 transforms (2 inverse/forward round trips), about 7 dynamics, about 25 physics and surface, and about 5 reductions.
- **DP6.4 — Profiling.** Benchmarks request the `timestamp-query` feature and launch Chrome with `--enable-webgpu-developer-features`. Without that flag Chrome rounds timestamps to 100 µs, which is coarser than most of these kernels. Per-kernel GPU time is reported by kernel name. Timing runs omit the queries.

### DP7 — Remove the Wasm engine (→ FR7)

- Delete the Wasm targets, shared-memory layer and app hook. Move what's left of `scripts/exoplasim-wasm/` to `scripts/exoplasim-reference/` (native builds, coverage, probes). Delete `public/gcm/tNN/ranks-N/` and `exoplasim.data`. Ship `public/gcm/tNN/inputs.json`, mapping each shipped namelist and `.sra` file name to its text and generated by `scripts/exoplasim-reference/package-inputs.py`. Drop `ranks` from the manifest. Remove the rank selector and cross-origin-isolation headers (`vite.config.ts`, the `src/bootstrap.ts` check, the GitHub Pages workflow) once a grep confirms nothing else uses `SharedArrayBuffer`.

## 4. Matrix

| | DP1 precision | DP2 arena/encoder | DP3 dynamics | DP4 physics | DP5 control/IO | DP6 throughput | DP7 removal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FR1 precision | X | — | — | — | — | — | — |
| FR2 residency | — | X | — | — | — | — | — |
| FR3 dynamics | X | — | X | — | — | — | — |
| FR4 physics | X | — | — | X | — | — | — |
| FR5 control/IO | — | X | — | — | X | — | — |
| FR6 throughput | X | X | X | X | X | X | — |
| FR7 single engine | — | — | — | — | X | — | X |

**Decoupled (lower triangular).** Required order: **DP1 → DP2 → DP3 → DP4 → DP5 → DP6 → DP7.**

- FR1 is judged on the Fortran f32 build alone, so no GPU design choice affects it. DP1 comes first because it decides which variables DP3 and DP4 store as df64.
- FR3 and FR4 are judged on replayed reference inputs (V3). Physics fidelity therefore doesn't depend on the transforms, and arena addressing (DP2) doesn't change arithmetic. DP2 still comes before DP3 and DP4, because their kernels are written against its registry header.
- DP5 depends on DP2's prognostic flags for checkpoints. Pause latency is decoupled from kernel speed by sizing batches from measured time (DP5.2) rather than a fixed step count. Without that, faster or slower kernels from DP6 would change FR5.
- FR6 is affected by every DP before it: df64 cost, dispatch count, kernel efficiency and readback. So DP6 tuning comes after the others are correct, and only re-checks V3 and V5.
- DP7 deletes the old runner only after DP5's runner replaces it.

Implementation phases follow that order. Each ends when its verification passes:

| Phase | DPs | Ends with |
| --- | --- | --- |
| P0 Reference and gates | DP1, V1, V0 spike | f32 gate decision, coverage list, dispatch-cost measurement, fresh Wasm baselines |
| P1 Infrastructure | DP2 | Arena, registry, encoder skeleton, reductions, probe harness |
| P2 Dynamics | DP3 | Transforms and adiabatic core pass V3 |
| P3 Physics | DP4 | Every covered routine passes V3, in `gridpointd` order |
| P4 Integration | DP5 | Full model passes V4, V5 and V6 in the page |
| P5 Speed and cutover | DP6, DP7 | V7 recorded, Wasm removed, docs updated |

**P0 feasibility gate.** Before P1 (spike: `node scripts/exoplasim-webgpu/spike.mjs`), a spike measures the empty-dispatch cost in one compute pass (200 dispatches, timestamp queries) and a T42 truncated DFT plus Legendre round trip for 10 levels × 8 fields on this machine. Projected step time = measured dispatch cost × 60 + transform time × 2 + a physics allowance. The physics allowance is native serial physics time ÷ 20, from the doc's native serial T21 one-day time and profile shares, scaled by 4 to T42 columns. If the projection is not below the fresh 8-rank Wasm per-step time at T42, stop and report to the user before P1.

**Information Axiom.**
- *Port method.* There is no maintained Fortran → WGSL compiler. Possible alternatives are an LLVM-IR-to-SPIR-V route, which WebGPU can't consume and which would not parallelize Fortran's column loops anyway, or a hybrid with GPU dynamics and Wasm physics. The hybrid fails the "entire model" objective and pays two CPU↔GPU copies per step, while physics is most of the time (`gridpointd` is 46.8% of sampled self time, radiation 9.2% more). A hand port, verified routine by routine against replayed reference states, is the only option whose correctness can be shown piece by piece.
- *Precision.* "f32 everywhere, no gate" is backed only by one-day Wasm single-precision runs (0.04 K mean surface difference at T42), and ExoPlaSim warns that precision 4 may be less stable. "df64 everywhere" costs 10–20× in arithmetic. The gate settles it with evidence.
- *FFT vs truncated DFT.* Both are accurate enough (DP3.1). The DFT is one kernel shape, and its cost (about 0.1 ms per step) is below the dispatch-cost uncertainty, so the simpler design has the higher probability of being correct.
- *Uncertainty.* The largest unknowns are WGSL transcendental accuracy in radiation (DP4.3), the gate's outcome (DP1.3), and the per-dispatch cost in Chrome on this driver. The first is caught by V3, the second by V2, the third by the P0 spike.

## 5. Expectations

Baselines: fresh Wasm runs from P0 (historical `stats/` reports are absent from this checkout), on Chrome on this machine (8 cores / 16 threads, RTX 2070 SUPER), double precision, 8 ranks, 3 interleaved runs in fresh Chrome processes. Workloads: T21 480 steps at 30 minutes (historical median 6.85 s), and T42 320 steps at 45 minutes (no historical double run; single precision was 19.0 s).

**Behavioural statistics**
- *f32 gate (V2):* expect f32 to pass at T21. The one-day T42 single-precision differences (0.04 K surface, 9 Pa) are an order of magnitude below interannual variability. The demoted explicit `real(8)` variables are untested, so a T42 failure is plausible, most likely in the semi-implicit solve or Legendre tables, which DP1.4 already computes in f64. The size of the 20-year climate shift is unknown, so no numerical estimate is given. Direction: the gap between f32 and f64 global means is smaller than 2σ√(2/N).
- *Kernel fidelity (V3):* expect the GPU's error ratio against the f32 Fortran error to be near 1 for transforms and dynamics (same algorithms, tree sums). Radiation could reach 2 or more before any `pow` replacement, because of WGSL's `exp2` error bound.
- *Coverage (V1):* about 15–20k reachable Fortran lines in the time loop. That is the about 32k linked lines minus the excluded modules (about 7.9k), the MPI, utilities and restart layers (about 1k), and init and debug code. About 1.7k of `specblock.f90` is a data table.
- *Arena:* T21 about 15 MB, T42 about 60 MB (DP2.1 estimate).
- *Downloads:* inputs only, with no Wasm. The current page downloads 4.6 MB (T21) and 12.7 MB (T42), of which about 2.3 MB at T21 is boundary data, so roughly a 50% reduction at T21. Shader source adds under 0.5 MB.

**Execution latency**
- *Per step at T21:* 0.5–2 ms, against about 14 ms now (6.85 s / 480). Low end: dispatch overhead (about 60 × 5 µs) plus the radiation critical path, assuming each GPU thread runs a column 10–30× slower than a CPU core (native serial radiation is about 2.7 µs per column). High end: per-dispatch cost of 20 µs. That is 7–28× faster. The uncertainty is mostly the per-dispatch cost, which the P0 spike measures.
- *Per step at T42:* 1–5 ms, against about 60 ms now (19 s / 320, single precision; double will be higher). Transforms add about 0.2 ms, physics grows with 4× the columns (8192 columns are 3.2 threads per CUDA core, so close to one occupancy wave). That is 12–60× faster. If DP1.3 requires df64 in hot kernels, multiply those kernels' share by up to 10–20×.
- *`/gcm` throughput:* the GPU will no longer be the limit. Snapshot handling on the main thread probably will. At T21 and 1 ms per step, `publishEvery = 4` means 250 snapshots per second, each accumulated by `averages`. Expect page throughput well below the benchmark's, plausibly 20–60 model days/s at T21 and 5–20 at T42, against 2 and 0.30 today. This is directional; V7 measures it and decides whether the follow-up in the Exclusions is needed.
- *Startup:* pipeline compilation for about 50 kernels is plausibly 0.2–1 s on first load (Dawn compiles WGSL to HLSL/DXIL on Windows), against about 50 ms of Wasm instantiation. Chrome's shader cache shortens later loads.

## 6. Verification

Everything runs from the repository root. Never overlap two benchmarks, or a benchmark with an open `/gcm` page.

**V0 — Required on every change.** `pnpm lint`, `pnpm typecheck`. Checks that use Chrome confirm `adapter.info` reports the hardware GPU (not SwiftShader) and record the vendor, architecture and Chrome version.

**V1 — Coverage (→ DP4.1, FR4 scope).** `wsl -d Ubuntu -- python3 scripts/exoplasim-reference/reference.py build --truncation 21 --coverage`, then `python scripts/exoplasim-reference/coverage.py <captures…> --output <report.json>`. Inputs come from `node scripts/exoplasim-reference/export-page-inputs.mjs <inputs-t21> <inputs-t42>`. Each configuration below runs 1 model year, and `gcov --json-format` is captured after each run, cumulatively. The page defaults already have vegetation, glaciers, a star temperature and the `gp`/`exp`/`sp` filters on, so the matrix changes several switches at once away from those defaults:

| Config | Settings (everything else at page defaults) |
| --- | --- |
| `earth` | Page defaults |
| `restart` | `earth`, restarted from its `plasim_status` for 1 more year |
| `bare` | Earth surface climatology off |
| `alt1` | Vegetation off, glaciers off, ozone off, filter `none`, 30-minute steps |
| `alt2` | No star temperature (wet soil on), filter `lh`, NRADINT 3, vegetation 1 |
| `orbit` | Eccentricity 0.3, obliquity 60°, fixed orbit off, filter `cesaro`, rotation period 2 days |

  - *Value 1 year:* every calendar-triggered branch (monthly, and the annual glacier and carbon updates at the year boundary) fires at least once in a year, and `restart` adds a second year for `earth`. The user chose this over 2 years per configuration on 2026-10-25.
  - *Limitation:* continuous settings (flux, pressures, year length, initial growth, glacier thresholds) are covered only at the values above. Branches that depend on their thresholds are found later by V3 replays at other states.

  Accept when the union of executed lines in routines classified as time-step work (not setup or shutdown) is listed per routine in `docs/climate/exoplasim-webgpu.md`, and each excluded module in §1 shows no executed time-step lines. A reached exclusion moves into scope. T42 coverage is deferred along with the T42 gate (DP1.2): the code paths don't depend on resolution, but before P3 an `earth` T42 capture confirms that no extra routines appear.

**V2 — Precision gate (→ FR1, DP1).** Build the f64 and f32 references (DP1.1, `--ranks 8`). Run DP1.2. `node scripts/exoplasim-reference/compare-climate.mjs --reference <f64 run> --candidate <f32 run> --discard 5 --output <report.json>` reads the annual zonal means written by `gcm_reference.f90`. It reuses `GCM_GRID` for Gaussian weights and `GCM_BALANCE` for the balance verdict, and covers the annual means of global mean surface temperature, 2 m temperature, precipitation, total cloud cover, OLR, net TOA and surface pressure, and zonal-mean surface temperature in NLAT/4 bands.
- *Pass rule:* for every global quantity, |mean_f32 − mean_f64| ≤ 2 σ √(2/N), with σ the f64 run's interannual standard deviation over the kept years. Zonal bands must pass in at least 90% of bands. Both runs stay finite, and `balance` reaches the same verdict (balanced or not) at the end.
  - *Value 2σ√(2/N):* the 95% two-sample test for a difference of two N-year means with equal variance.
  - *Value 90%:* with NLAT/4 = 8 (T21) or 16 (T42) bands at 95% each, about 0.4–0.8 bands are expected to fail by chance. 90% allows one failure at T21 and one at T42.

  Record the decision and any df64 variable list from DP1.3.

**V3 — Kernel fidelity by probe replay (→ FR3, FR4).**
- *Probe build:* `gcm_probe.f90`, appended to `plasim.f90` the way `gcm_publish.f90` is today. At probe points before and after `gridpointa`, `spectrala`, each `gridpointd` sub-step (transform block, `miscstep`, `fluxstep`, `radstep`, `rainstep`, `surfstep`, `carbonstep`, reductions) and `spectrald`, it dumps every module array the build script finds in the module declarations. Dumps are raw binary, with a JSON index, to `stats/exoplasim-reference/probe/<config>/<date>/<point>.bin`. In replay mode the f32 build *loads* the "before" dump, rounded, instead of using its own state, runs the routine, and dumps "after".
- *States:* `earth` on 1 January and 1 July of year 2. Two dates cover both hemispheres' snow and sea-ice branches. Add each V1 configuration whose coverage adds lines not covered by `earth`, at one date.
- *GPU replay:* `node scripts/exoplasim-webgpu/verify-kernels.mjs <config> <date> [point]` opens a harness page in Chrome. It fills the arena from the f64 "before" dump, runs the kernels for that probe point, reads the arena back, and writes `stats/exoplasim-webgpu/kernels/<config>-<date>.json`.
- *Pass rule per output field:* RMS(GPU − f64) ≤ 2 × RMS(f32 replay − f64). Also, the number of points with |GPU − f64| above 10⁻⁵ × RMS(f64 field) must be at most 2 × that count for the f32 replay, plus 1.
  - *Value 2×:* two f32 evaluations of the same expression in different orders each satisfy the same error bound (Higham §3.1), so the GPU may differ from f64 by up to that bound twice. The +1 allows a single branch flip at a threshold when the f32 replay had none.
  - *Value 10⁻⁵:* about 84 ULPs at f32. It is the recursive-summation bound γₙ for n ≈ 64 terms (6.4 × 64 × 2⁻²⁴ ≈ 3.8 × 10⁻⁶), rounded up, so normal accumulation in a column stays under it.
- *Stochastic kernels (DP4.4):* compare mean and standard deviation of each output field over 10 replays with different keys against 10 f32 replays with different seeds. Each must agree within the 2σ√(2/10) rule.
- *Transforms in isolation:* `fc2sp(sp2fc(x)) = x` for random spectral fields to within 10⁻⁵ relative RMS (the same bound with n = NLAT).

**V4 — Short trajectories (→ FR2, FR3, FR4 integrated).** `run-browser.mjs` gains `EXOPLASIM_ENGINE=webgpu`. It writes the same report and six-field `fields` output and compares them with `EXOPLASIM_REFERENCE`. The GPU starts from the f64 reference's step-0 dump, after the kick, so both see the same noise. After 2 and 48 steps at T21 (30 min) and 2 and 32 steps at T42 (45 min), the per-field RMS difference from f64 must be at most 2 × the f32 reference's RMS difference from f64 at the same step, with the same 2× reasoning as V3. Also check that no state is read back during integration: wrap `mapAsync` and `copyBufferToBuffer` in the harness and require that only the snapshot path calls them.

**V5 — Climate (→ C1, all FRs together).** `node scripts/exoplasim-webgpu/run-climate.mjs` runs the GPU model headless for 30 years at T21 and 15 at T42, at page defaults. It saves annual means, then applies V2's comparison against the f64 reference runs from V2. The pass rule is the same as V2.

**V6 — Page (→ FR5).** `pnpm dev`, `/gcm`, T21 and T42 with Earth defaults.
- The map updates. Snapshot `step` values arrive strictly increasing by `publishEvery`, checked by a page hook in the Playwright app harness.
- Pause stops the displayed date within 100 ms, measured over 10 presses with `performance.now()` from the click to the last snapshot.
- Save → Clear → Load restores date, step and diagnostics. Continuing 48 steps after Load gives fields identical to continuing 48 steps without saving, because one device is deterministic.
- Loading a format-3 checkpoint is rejected with a message.
- Forcing `device.destroy()` from the harness reports device loss. Injecting NaN into the arena stops the run at the next snapshot.
- In a browser profile with WebGPU disabled, the page says WebGPU is required.
- Custom terrain (PNG and Chaos binary) runs, per `docs/climate/custom-terrain.md`.

**V7 — Throughput (→ FR6).** `EXOPLASIM_ENGINE=webgpu node scripts/exoplasim-wasm/run-browser.mjs 480` (T21, 30 min) and the T42 320-step at 45 min run (`EXOPLASIM_MPSTEP=45`), 3 interleaved Wasm/WebGPU pairs on fresh Chrome. The script path becomes `scripts/exoplasim-reference/run-browser.mjs` after DP7. Accept when the slowest WebGPU run beats the fastest Wasm run at both resolutions. Record per-kernel GPU time from a separate `EXOPLASIM_PROFILE=1` run (DP6.4), dispatches per step, arena size and pipeline compile time. In the page, record Speed (model days/s) for 30 model days at T21 and T42, and the main-thread time spent in snapshot handling from a Chrome performance trace. Compare everything with §5.

**V8 — Removal (→ FR7).** After DP7: `rg -n "exoplasim.wasm|ranks-|SharedArrayBuffer|library_shm|mpimod_shm" src public scripts docs vite.config.ts .github` returns nothing outside `scripts/exoplasim-reference/` and archived docs. `pnpm build` succeeds. `pnpm knip` reports no unused exports from the removed runner. The deployed GitHub Pages build loads `/gcm` without cross-origin-isolation headers.

## 7. Documentation updates

`docs/climate/exoplasim-wasm.md` (271 lines) mixes the Wasm engine, its performance history, the native reference and the `/gcm` page. After this plan the Wasm engine is history, so it gets split.

- **Create** `docs/climate/exoplasim-webgpu.md`: engine overview and the meaning of "entire model" (§1); the precision decision with V2 results and any df64 list; arena and registry layout; transform algorithms (truncated DFT, hemispheric Legendre); kernel list per Fortran routine with V1 coverage and documented unreached branches; reductions and determinism; batching and pause latency; snapshot and checkpoint format 4; and all V3–V7 measurements, which per AGENTS.md go in this document.
- **Create** `docs/climate/exoplasim-reference.md`: the Fortran reference toolchain (WSL setup, gfortran f64/f32 builds, `-cpp`, OpenMPI ranks, coverage, probe dump and replay, input packaging). It takes the "Reproduce", native-comparison and "Port adjustments" material that is still true from `exoplasim-wasm.md`.
- **Move/split** the "Chaos Machine `/gcm` page", "Map interaction and settings" and "Asset loading" sections into a new `docs/climate/gcm-page.md`, with the model-module list updated for the new GPU modules and without ranks. Rewrite "Asset loading" for `inputs.json` and pipeline compilation.
- **Move** what remains of `docs/climate/exoplasim-wasm.md` (Wasm baselines, optimization history, shared-memory ranks, single precision, radiation interval) to `docs/climate/history/exoplasim-wasm.md`, with a one-line header saying the engine was retired and linking to `exoplasim-webgpu.md`. Its radiation-interval and single-precision measurements stay there as the CPU baseline, cited from the new doc.
- **Edit** links: `docs/climate/custom-terrain.md` (any link into `exoplasim-wasm.md`), `README.md`, and `scripts/exoplasim-reference/README.md` (moved from `scripts/exoplasim-wasm/README.md`, rewritten for reference builds only).
- **Edit** `AGENTS.md`, section "ExoPlaSim port": point to `docs/climate/exoplasim-webgpu.md` and `scripts/exoplasim-reference/`, replace the Fortran-rebuild rule with "after changing a kernel, run its V3 replay", and keep the benchmark non-overlap rule with the new runner path.

## 8. Module organization

Dependency direction: `runner` (worker) → `stepper` → domain kernels (`transform`, `dynamics`, `physics/*`) → `layout` + `src/model/shared/gpu`. `setup` → `grid`, `namelist`, `boundary`, `layout`, `calendar`. No domain imports `runner`. WGSL files are imported with Vite `?raw` only by the domain `index.ts` that owns them.

**New domains in `src/model/climate/gcm/`** (each `index.ts` + `types.ts`, plus a `wgsl/` folder for kernel sources where it has kernels):

| Folder | Namespace | Responsibility | DP |
| --- | --- | --- | --- |
| `device/` | `GCM_DEVICE` | Adapter and device request with the limits computed by `layout`, loss and error reporting | DP2.1, DP5.5 |
| `layout/` | `LAYOUT` | Field registry, offsets, WGSL header generation, prognostic slice, arena create/read/write | DP2.1, DP2.2, DP5.4 |
| `calendar/` | `CALENDAR` | f64 date, orbit and declination per step (ports `calmod`, `orb_*`), periodic-call schedule, step-parameter buffer contents | DP2.5, DP2.3 |
| `setup/` | `SETUP` | f64 ports of `prolog`/`readnl`/`initpm`/`initsi`/`legini`/`noise`/`*ini`, parsing namelist text and `.sra` into the tables buffer and initial arena | DP1.4, DP3.4 |
| `transform/` | `TRANSFORM` | Delegates to `fourier/` (`FOURIER`, truncated DFT) and `legendre/` (`LEGENDRE`, `legmod` ports) | DP3.1, DP3.2 |
| `dynamics/` | `DYNAMICS` | `gridpointa`, `spectrala`, `spectrald`, semi-implicit solve, diffusion, time filter | DP3.3 |
| `physics/` | none (category) | Sub-domains, each one namespace for one Fortran module: `radiation/` `RADIATION`, `precipitation/` `PRECIPITATION` (`rainmod`), `surface-flux/` `SURFACE_FLUX` (`fluxmod`), `fixer/` `FIXER` (`miscmod`), `surface/` `SURFACE` (`surfmod`), `land/` `LAND`, `sea/` `SEA` (`seamod`), `sea-ice/` `SEA_ICE`, `ocean/` `OCEAN` (slab), `vegetation/` `VEGETATION` (`simba`), `carbon/` `CARBON`, `glacier/` `GLACIER`, `stability/` `STABILITY` | DP4 |
| `stepper/` | `STEPPER` | Encodes a step and a batch in `master` order, batch sizing, in-flight limit | DP2.3, DP5.2, DP6.2 |
| `snapshot/` | `SNAPSHOT` | Pack kernel (ports `gcm_publish.f90`), staging ring, ordered posting | DP5.3 |

Each physics or dynamics namespace exposes only `pipelines(device)` and `encode({ pass, step })`, with input types in its own `types.ts` (one parameter per function, per AGENTS.md). Physics sub-domains with kernels in more than one Fortran routine (`radiation`: `solang`, `mko3`, `swr`, `lwr`; `precipitation`: `kuo`, `mklsp`, …) keep one WGSL file per routine in their `wgsl/` folder. They are not split into further TypeScript submodules unless `index.ts` passes about 250 lines.

**New shared module `src/model/shared/gpu/`** (`GPU` namespace, generic and not GCM-specific): WGSL composition (header + library + body), the deterministic tree-reduction kernel (DP2.4, called by `fixer`, `carbon`, `stability` and the diagnostics), and Philox (DP4.4, only if V1 reaches a stochastic branch). `df64.wgsl` (DP1.3) and `math.wgsl` (DP4.3) are added only when their conditions are met and they have two callers.

**Edited**
- `grid/`: already computes Gaussian latitudes in f64 for any count. `setup` reuses it instead of porting `inilat`'s quadrature.
- `namelist/`: unchanged in role. It stays the single producer of namelist text (C2). `setup` adds parsing of the merged text, reusing `GCM_NAMELIST.apply`'s tokenizer rather than writing a second one.
- `boundary/`: unchanged output (`.sra` text). `setup` parses it.
- `runner/`: `gcm.worker.ts` hosts `GCM_DEVICE`, `SETUP`, `STEPPER`, `SNAPSHOT`. `index.ts` drops ranks, exchange and control buffers. `types.ts` drops `ExoplasimModule`, `ExoplasimFactory`, `exchange` and `moduleUrl`.
- `checkpoint/`: format 4 (DP5.4), using `LAYOUT`'s prognostic slice.
- `src/ui/gcm/GcmConfigPanel.tsx`, `useGcmRun.ts`, `types.ts`: remove the worker-count control and add the WebGPU-required and device-lost states, following `src/ui/components/UI.md`.
- `vite.config.ts`, `src/bootstrap.ts`, GitHub Pages workflow: remove cross-origin isolation (DP7).

**Scripts**
- `scripts/exoplasim-wasm/` → `scripts/exoplasim-reference/` (git move at P5; before that, new files are added in place and moved with the rest).
  - Kept: `setup.sh` (Wasm toolchain steps deleted), `run-browser.mjs` (WebGPU engine only after P5).
  - Added in P0: `model_source.py` (source copy and patches shared by `build.py` and `reference.py`), `reference.py` (gfortran/OpenMPI `build` with `--precision`, `--demote-double`, `--coverage`, and `run`), `gcm_reference.f90` (annual zonal means hook), `coverage.py`, `compare-climate.mjs`, `export-page-inputs.mjs` (writes the page's namelists and `.sra` through Vite's `createServer` in middleware mode, as `export-chaos-fixture.mjs` does). `reference.py` gains `--probe dump|replay` in P1.
  - New later: `gcm_probe.f90`, `package-inputs.py`. `build.py` is deleted at P5, once its Wasm targets go.
  - Deleted: `compile.py`, `runtime.py`, `runtime-check.f90`, `verify-runtime.py`, `mpimod_shm.f90`, `library_shm.js`, `library_gcm.js`, `gcm_publish.f90` (replaced by `SNAPSHOT`), `worker.js`, `build_app.py`.
- New `scripts/exoplasim-webgpu/`: `verify-kernels.mjs` (V3), `run-climate.mjs` (V5), and the harness page they load.
- `package.json`: `build:gcm-wasm` becomes `build:gcm-inputs` (runs `package-inputs.py`).

**Reuse checks before adding code:** Gaussian quadrature (`grid`), namelist tokenizing (`namelist`), `.sra` writing format (`boundary`, which `setup`'s parser mirrors), the seeded generator (`src/model/shared/random/rng`), the snapshot message and field layout (`fields`, `runner/types.ts`), and the Vite-in-Node script pattern (`export-chaos-fixture.mjs`).
