# ExoPlaSim on WebGPU

This is the reference for porting ExoPlaSim's time integration to WebGPU compute shaders. The design and its phases are in [plans/exoplasim-webgpu.md](../../plans/exoplasim-webgpu.md). The current Wasm engine is described in [exoplasim-wasm.md](exoplasim-wasm.md).

## P0: reference toolchain, baselines and gates (2026-10-25)

Machine: 8 cores / 16 threads, NVIDIA GeForce RTX 2070 SUPER (Turing), Chrome 155.0.8059.85, WSL Ubuntu 22.04 with GNU Fortran 11.4.0 and OpenMPI.

### Fortran references

`scripts/exoplasim-wasm/reference.py build` makes native gfortran builds with OpenMPI from the same patched sources as the Wasm builds. Both use `model_source.py`. Its patch output matched an existing Wasm benchmark build's `model-source.patch` byte for byte. Every build uses `-cpp` (see the `carbonmod.f90` note in [exoplasim-wasm.md](exoplasim-wasm.md#shared-memory-ranks)), and the upstream `mpimod.f90` and `utilities.f90` for ranks.

| Build | Flags | Use |
| --- | --- | --- |
| f64 | `-O2 -fdefault-real-8 -fdefault-double-8` | Double-precision reference |
| f32 | `-O2 -freal-8-real-4`, default 4-byte reals | No f64 anywhere, as in WGSL |
| coverage | f64 with `-O0 --coverage` | Reachable code (V1) |

Wasm's `--precision 4` keeps every explicit `real(kind=8)` in double, including the Gaussian latitudes and weights (`sid`, `gwd`). The f32 build also demotes those. That requires two hard-coded `MPI_REAL8` transfers (`mpscdn` in `mpimod.f90`, the gather in `utilities.f90`) to become `MPI_REAL4`, because their buffers shrink. `objdump` of the f32 objects finds double-precision instructions only in `pumax_stub.o`, which is not on the model path.

`gcm_reference.f90` is appended to `plasim.f90` and called after each step. It sums Ts, T2m, precipitation, cloud cover, OLR, net TOA, surface pressure, net surface heat (`hfns`, as in `gcm_publish.f90`) and sea ice in every step. At each 1 January 00:00 it writes zonal means to `reference-means.txt`. A one-year T21 run held 11,520 samples (360 days × 32 steps), as expected.

`reference.py run` copies an input directory, sets the run length, and runs `mpirun` with an unlimited stack. One T21 year at 45-minute steps took 114 s at 8 ranks.

Inputs come from `export-page-inputs.mjs`. It loads the page's `GCM_TERRAIN`, `GCM_BOUNDARY` and `GCM_NAMELIST` through Vite in Node, regrids the Earth elevation raster the page uses, and writes namelists and `.sra` files for each coverage configuration at T21 and T42 to `stats/exoplasim-reference/inputs/`.

### Wasm baselines

Run with `scripts/exoplasim-wasm/run-browser.mjs`: 8 ranks, double precision, frontend `-O2`, 3 interleaved rounds in fresh Chrome processes. Reports are in `stats/exoplasim-webgpu/baseline/`.

| Workload | Runs (s) | Median | Per step |
| --- | --- | --- | --- |
| T21, 480 steps at 30 min | 7.82, 7.14, 7.14 | 7.14 s | 14.9 ms |
| T42, 320 steps at 45 min | 18.22, 18.50, 17.73 | 18.22 s | 56.9 ms |

### Dispatch and transform spike

`node scripts/exoplasim-webgpu/spike.mjs` runs headless Chrome with `--enable-unsafe-webgpu --enable-webgpu-developer-features`. Headless mode received the hardware adapter (`nvidia`, `turing`). Times are medians of 30 submissions, measured with pass timestamp queries. Report: `stats/exoplasim-webgpu/spike/spike.json`.

| Measurement | GPU time |
| --- | --- |
| Dependent dispatch, 64 / 2048 / 8192 threads | 1.62 / 1.65 / 1.76 µs each |
| T42 truncated DFT, 5120 rows → 86 coefficients | 0.17 ms |
| T42 forward Legendre, 80 field-levels × 946 coefficients | 0.17 ms |
| T42 inverse Legendre | 0.31 ms |
| T42 inverse DFT | 0.14 ms |
| T42 round trip, one pass | 0.79 ms |

The first forward DFT read its table with a stride of `NLON` between adjacent threads and took 1.84 ms. Storing the table as `[lon][coefficient]` made the reads contiguous and brought it to 0.17 ms. Kernel layouts need the same check.

Every submission waited about 3 ms from `submit` to `onSubmittedWorkDone`, whatever its size. That is the floor DP5.2's 25 ms batch budget amortizes. One step per submission would cost 3 ms of latency.

Feasibility projection for a T42 step:
- dispatches: 60 × 1.76 µs = 0.11 ms;
- two transform round trips: 1.58 ms;
- physics allowance: 4.13 ms. That is native serial T21 at 36.9 ms per step (1.77 s per 48-step day), times its 56% physics share (`gridpointd` 46.8% plus `swr`/`lwr` 9.2% in the 8-rank `-O2` profile), divided by 20 and multiplied by 4 for T42's columns.

The total is 5.8 ms against 56.9 ms for Wasm, about 10× faster. The gate passes. The physics allowance is an assumption, not a measurement. P3 replaces it with measured kernel times.

### Coverage (V1, T21)

Coverage ran on the gfortran `-O0 --coverage` build, 8 ranks, 1 model year per configuration. Configurations, in order: `earth`, `restart` (1 more year from `earth`'s `plasim_status`), `bare`, `alt1`, `alt2`, `orbit` (see V1 in the plan). Captures are cumulative `gcov --json-format` output in `stats/exoplasim-reference/coverage/`. The summary is from `scripts/exoplasim-wasm/coverage.py` (`stats/exoplasim-reference/coverage-t21.json`).

Per-step work is any routine called at least 1,000 times that isn't in the setup list. Setup routines run once per rank, or a few hundred times for surface-file reads, so the line between them is wide. On that definition, 80 routines run per step, with 2,573 of their 4,151 executable lines executed. Executed lines by file:

| File | Lines | File | Lines |
| --- | --- | --- | --- |
| `rainmod.f90` | 474 | `oceanmod.f90` | 86 |
| `plasim.f90` (dynamics, `gridpoint*`, `spectral*`, `mkdheat`) | 414 | `simba.f90` | 69 |
| `fftmod.f90` | 315 | `miscmod.f90` | 52 |
| `radmod.f90` | 300 | `calmod.f90` | 48 |
| `icemod.f90` | 239 | `carbonmod.f90` | 24 |
| `fluxmod.f90` | 230 | `seamod.f90` | 23 |
| `landmod.f90` | 158 | `gaussmod.f90` | 19 |
| `legmod.f90` | 110 | `glaciermod.f90`, `surfmod.f90` | 7, 5 |

These are gcov executable lines, not source lines. The plan's estimate of 15–20k source lines counted comments, declarations, continuation lines and unexecuted branches. Of these lines, `fftmod.f90` and `legmod.f90` (425) are replaced by the truncated DFT and Legendre kernels rather than ported. `calmod.f90` (48) moves to f64 TypeScript (DP2.5). That leaves about 2,100 executed lines for WGSL.

Settings other than the defaults added 48 lines in total: `getalb` and `radstep` (the NRADINT cache) in `alt2`, and one line of `mko3` in `alt1`. `bare`, `orbit` and `restart` reached nothing new.

Excluded modules:
- `tpcore.f90`, `trc_routines.f90`, `aeromod.f90`, `aerocore.f90`, `cpl_stub.f90` and `lsgmod.f90` executed nothing.
- `tracermod.f90`'s `tracer_ini0` is setup.
- `guimod_stub.f90` entries are empty stubs.
- Two diagnostic paths run every step: `outmod.f90`'s `outaccu`/`outreset` ("accumulate diagnostic arrays" for file output, with `NOUTPUT = 0`) and 13 lines of `hurricanestep` (storm masks). Both stay excluded if P3 confirms that no prognostic or physics array reads what they write.

T42 coverage is deferred (plan DP1.2, V1).

### Precision gate (V2, T21)

The f64 and f32 builds each ran 15 years from the page's Earth defaults at 45-minute steps, 8 ranks (1,730 s and 1,751 s; f32 is no faster in scalar native code). `compare-climate.mjs` dropped years 1–5 and compared years 6–15 (`stats/exoplasim-reference/gate-t21.json`).

The climate was still spinning up: global surface temperature rose 0.17 K/yr over years 6–15 in both runs, and net TOA fell from about 8 W/m² in year 1 to near 0 by years 12–15. `balance` reports both as drifting. An ordinary σ includes that trend, so the comparison takes σ from residuals about a least-squares line.

| Global annual mean, years 6–15 | f64 | f32 | \|Δ\| | 2σ√(2/N) |
| --- | --- | --- | --- | --- |
| Surface temperature (K) | 292.873 | 292.908 | 0.035 | 0.161 |
| 2 m temperature (K) | 292.519 | 292.541 | 0.022 | 0.170 |
| Precipitation (m/s) | 3.628e-8 | 3.624e-8 | 3.8e-11 | 2.8e-10 |
| Cloud cover | 0.5656 | 0.5661 | 0.0005 | 0.0016 |
| OLR (W/m²) | 236.87 | 237.00 | 0.13 | 0.36 |
| Net TOA (W/m²) | 0.576 | 0.548 | 0.027 | 0.367 |
| Surface pressure (Pa) | 97466.6 | 97467.0 | 0.40 | 0.70 |

Every global mean passes. Surface-temperature trends are 0.165 (f64) and 0.184 (f32) K/yr. Year-by-year paired differences in global surface temperature average 0.035 K with a standard deviation of 0.064 K (t = 1.75 against 2.26 at 9 degrees of freedom). No single year differs by more than 0.2 K.

Seven of 8 zonal surface-temperature bands pass. The northernmost (rows 1–4, about 76–87°N) is 1.00 K warmer in f32, against a 0.49 K threshold. Its yearly f32 − f64 difference ranges from −1.38 to +2.86 K, following sea-ice differences: f32's northern sea ice runs 0.03–0.08 lower in years 8–10. The southernmost band swings from −1.22 to +1.00 K but passes, because its σ is larger.

7/8 is 87.5%, below the 90% rule, so the gate has **not passed**. The plan's text said 90% allows one failed band at T21, which was arithmetically wrong. The rule is not loosened after seeing the data. Telling a precision effect from polar variability needs a control: a second f64 run with a different `SEED`, which gives the spread between two f64 runs.

#### Control run and verdict

A second f64 run differed only in `SEED = 27182818,2,3,4,5,6,7,8`: 15 years, 1,958 s, report in `stats/exoplasim-reference/control-t21.json`. It measures how far two runs with the same arithmetic separate through chaos alone.

| Band (rows) | f64′ − f64 (K) | f32 − f64 (K) | Threshold (K) |
| --- | --- | --- | --- |
| 1 (1–4, about 76–87°N) | 1.648 | 1.001 | 0.487 |
| 2 (5–8) | 0.415 | 0.007 | 0.222 |
| 3 (9–12) | −0.087 | −0.066 | 0.195 |
| 4 (13–16) | 0.038 | −0.051 | 0.122 |
| 5 (17–20) | 0.050 | 0.016 | 0.162 |
| 6 (21–24) | 0.173 | 0.059 | 0.177 |
| 7 (25–28) | 0.069 | −0.028 | 0.334 |
| 8 (29–32) | −0.255 | 0.090 | 0.593 |

In every global mean, the control's difference from f64 is larger than f32's: surface temperature 0.141 against 0.035 K, 2 m temperature 0.132 against 0.022 K, OLR 0.275 against 0.132 W/m², surface pressure 0.60 against 0.40 Pa, precipitation 5.6 against 3.8 × 10⁻¹¹ m/s.

**Verdict:** the T21 gate passes under the plan's control rule. f32's Arctic difference (1.00 K) is smaller than the f64-to-f64 difference (1.65 K) in that band. Every other f32 band and global mean already passed. At T21 the GPU uses f32 throughout (DP1.3), with no df64.

**Calibration:** two f64 runs fail the V2 band test themselves (6 of 8 bands, failing bands 1 and 2). σ from one run's detrended annual means underestimates how far two runs drift apart during spin-up, especially near the pole, where sea ice amplifies small differences. Global means stay well calibrated, with the control at 37–88% of the thresholds. For the T42 gate and the climate check (V5), the control run is therefore part of the test, not an afterthought.
