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

## P1/P2: state layout and spectral transforms (2026-10-25)

### Modules

| Module | Namespace | Role |
| --- | --- | --- |
| `src/model/climate/gcm/device/` | `GCM_DEVICE` | Adapter and device with the adapter's maximum buffer limits; reports device loss and uncaptured errors |
| `src/model/climate/gcm/layout/` | `LAYOUT` | Packs named fields into one f32 buffer. Shapes: `spectral` (NRSP per level), `fourier` (NLAT × NFC per level), `grid` (NHOR per level), `table`. Emits WGSL offset constants; writes and reads fields |
| `src/model/climate/gcm/kernel/` | `KERNEL` | One bind group (state read-write, tables read-only) and one pipeline layout shared by every kernel. Header with NTRU, NTP1, NLAT, NLON, NLEV, NHOR, NCSP, NRSP, NFC and every offset. Pipelines get per-use `override` constants (offsets, thread count); workgroup size 64 |
| `src/model/climate/gcm/fourier/` | `FOURIER` | `fftmod.f90`'s `gp2fc`/`fc2gp` as truncated DFT products, with f64 tables |
| `src/model/climate/gcm/legendre/` | `LEGENDRE` | f64 port of `legini` (`qi`…`qv`), the physics filters (`skgpsp`, `skspgp`), `fc2sp` (hemispheric symmetric/antisymmetric sums) and `sp2fc`/`sp2fcdmu` |

`GCM_GRID` now also keeps the latitude sines, which `legini` starts from.

Data layouts follow PlaSim. Spectral planes hold `(re, im)` pairs for modes ordered m = 0..NTRU, then n = m..NTRU. Fourier rows hold `(re, im)` for m = 0..NTRU, north to south. Grid rows run longitude fastest, north to south. Filter factors are folded into the Legendre tables in f64 before rounding to f32.

### Fourier convention

`reference.py build --ranks 1 --probe` appends `gcm_probe.f90` and calls it after `legini`. It dumps `sid`, `gwd`, `qi`…`qv`, `skgpsp`, `skspgp`, and `gp2fc`/`fc2gp` applied to every unit vector, which are the exact FFT matrices. Dumps are in `stats/exoplasim-reference/probe/tables-t21/` and `tables-t42/`.

The matrices fit, with λⱼ = 2πj/N:
- forward: cₘ = (1/N) Σⱼ gⱼ e^(−imλⱼ), stored as (Re, Im);
- inverse: gⱼ = Re c₀ + Σ_{m≥1} 2 (Re cₘ cos mλⱼ − Im cₘ sin mλⱼ), ignoring Im c₀.

The largest errors are 2.5 × 10⁻¹⁶ (forward) and 6.5 × 10⁻¹⁴ (inverse).

### Verification

`node scripts/exoplasim-webgpu/verify-kernels.mjs <probe directory>` serves the source through Vite, runs headless Chrome with WebGPU, and writes `stats/exoplasim-webgpu/kernels/transforms.json`.

Tables: every TypeScript f64 table matches the Fortran dump to at most 2.8 × 10⁻¹² relative (`qe`, `qm`, `qq` at T42, which divide by cos²φ). Sines, weights, filters and DFT matrices match to 10⁻¹³–10⁻¹⁶.

Kernels: 10 random spectral planes, page-default exponential filter. The chain is inverse Legendre → inverse Fourier → forward Fourier → forward Legendre in one compute pass. Each kernel is compared on its own f32 input with the Fortran operator, built from the probe tables and evaluated in f64. The comparator is the same loops in sequential f32. For Legendre that is Fortran's own loop order; for Fourier it is a dense product, which is less accurate than Fortran's f32 FFT.

| Kernel | T21 relative RMS | Ratio to sequential f32 | T42 relative RMS | Ratio |
| --- | --- | --- | --- | --- |
| `sp2fc` | 9.9 × 10⁻⁸ | 0.996 | 1.33 × 10⁻⁷ | 1.006 |
| `fc2gp` | 1.38 × 10⁻⁷ | 0.999 | 1.81 × 10⁻⁷ | 1.007 |
| `gp2fc` | 1.42 × 10⁻⁷ | 1.007 | 2.03 × 10⁻⁷ | 1.006 |
| `fc2sp` | 6.9 × 10⁻⁸ | 1.002 | 9.2 × 10⁻⁸ | 1.001 |

All pass the V3 rule (at most 2× the f32 comparator) and the 10⁻⁵ transform bound. Sequential summation in f32 is enough, so the tree-summed variant DP3.1 allowed for isn't needed.

### Vector and tendency operators

The rest of `legmod.f90` maps onto three more kernels in `legendre/wgsl/`. Each reproduces the term order of the Fortran statement it ports, so every output's sum is accumulated in the same order.

| Kernel | Ports | Inputs → outputs | Tables |
| --- | --- | --- | --- |
| `dv2uv.wgsl` | `dv2uv` | spectral divergence and vorticity → Fourier u, v at every latitude; subtracts `plavor` from Re mode (0, 1) of vorticity | `qu`, `qv` × `skspgp` |
| `uv2dv.wgsl` | `uv2dv`; with `HAS_KINETIC`, `mktend`'s divergence and vorticity | Fourier u, v (and kinetic energy) → spectral divergence and vorticity | `qe`, `qm` (and `qq`) × `skgpsp` |
| `qtend.wgsl` | `qtend`; `mktend`'s temperature tendency | Fourier flux u, flux v and source → one spectral tendency | `qe`, `qc`, `qm` × `skgpsp` |

`LEGENDRE.mktend` returns the two kernels it needs: `uv2dv` with the kinetic-energy term, and `qtend`. Both use the hemisphere split: S = north + s·south and D = north − s·south, with s = +1 when m + n is even. Every Fortran single-process branch reduces to one of those two combinations per term.

`LEGENDRE.kernelTables` names the eight tables `legendre_qc` … `legendre_qv`. It multiplies the grid-to-spectral tables (`qc`, `qe`, `qm`, `qq`) by `skgpsp` and the spectral-to-grid tables (`qi`, `qj`, `qu`, `qv`) by `skspgp`, as every loop in `legmod.f90` applies them. `sp2fcdmu` is `LEGENDRE.inverse` with `legendre_qj`. `sp2fl`, `invlega`, `invlegd` and `sp3fc` are loops over these and become dispatch lists in the step encoder.

`verify-kernels.mjs` compares each kernel with the Fortran statements, rebuilt from the probe's own tables and filters, on random inputs (`plavor` = 0.3). Results are in `stats/exoplasim-webgpu/kernels/transforms.json`.

| Kernel output | T21 relative RMS | Ratio to sequential f32 | T42 relative RMS | Ratio |
| --- | --- | --- | --- | --- |
| `dv2uv` u / v | 1.45 / 1.49 × 10⁻⁷ | 1.003 / 0.989 | 2.03 / 2.12 × 10⁻⁷ | 1.008 / 0.989 |
| `uv2dv` divergence / vorticity | 1.06 / 1.09 × 10⁻⁷ | 0.965 / 1.028 | 1.51 / 1.52 × 10⁻⁷ | 1.017 / 1.003 |
| `qtend` | 1.26 × 10⁻⁷ | 0.996 | 1.76 × 10⁻⁷ | 0.987 |
| `mktend` divergence / temperature / vorticity | 1.70 / 1.32 / 1.09 × 10⁻⁷ | 0.918 / 1.051 / 1.028 | 2.07 / 1.77 / 1.52 × 10⁻⁷ | 1.021 / 0.997 / 1.003 |

All pass the same rule.

## P2: dynamical core (2026-10-25)

### State probes and f32 replay

`reference.py build --ranks 1 --probe` also hooks five points into `master`'s main loop. They come after the `nkits` start-up steps, around `gridpointa` (a0 → a1), `spectrala` (a1 → a2), `gridpointd` (a2 → a3) and `spectrald` (a3 → a4).

- **Dumps.** At the steps given by `reference.py run --probe-steps`, counted from the start of the run, each point dumps every `pumamod` variable: 455 of them, 1.45 M values at T21. The dump and load code is generated from `plasimmod.f90`'s declarations by `probe_source.py`. Dumps use the build's default real and record its byte width. A fixed 8-byte kind wouldn't work, because `-freal-8-real-4` demotes every `real(kind=8)` declaration, the probe's own included.
- **Replay.** `run --replay <dumps>` converts another run's dumps to the build's precision and loads each one just before the next routine. That routine then runs on the other run's state, rounded once.
- **Load check.** Replaying the f64 dumps into the f64 build reproduces them bit for bit at every point.
- **What each routine changes.** Diffing consecutive dumps lists exactly what each routine writes:
  - `gridpointa`: `sdt stt szt sqt spt gd gt gz gq gu gv gp gpj dw dp0 du0 dv0`;
  - `spectrala`: `sd st sz sq sp` and their `p`, `t` (except `szt`, `sqt`) and `m` copies;
  - `spectrald`: the same spectral sets minus `sp`, `spp`, `spt`.
- **Runs.** `stats/exoplasim-reference/probe-states.sh` builds f64 and f32 probe references. It dumps the page's Earth defaults at 45-minute steps (T21 at steps 100 and 2000, T42 at 100 and 500), then replays those dumps into both builds.

### Kernels

| Routine | GPU work | Dispatches |
| --- | --- | --- |
| `gridpointa` | `invlega` (`dv2uv`, 5 inverse Legendre, d/dμ of ln ps), `gpmt` as `FOURIER.dlambda`, 9 inverse Fourier, `calcgp.wgsl`, 10 forward Fourier, forward Legendre of `gvpp`, `mktend` (2), `qtend` | 32 |
| `spectrala` | `spectrala.wgsl`: semi-implicit divergence (`bm1`), pressure and temperature corrections, first filter half, leapfrog, publish | 1 |
| `spectrald` | `spectrald-diffusion.wgsl`; `mkdheat` (3 `dv2uv`, 7 inverse and 3 forward Fourier, 3 forward and 1 inverse Legendre, `mkdheat.wgsl` stages 1–3, `mean-mode.wgsl`); `spectrald-update.wgsl` | 22 |

- **`calcgp.wgsl`.** One thread per column covers `gp = exp(gp)`, `calcgp`, the flux products (`gut`, `gvt`, `gke` + `gphi`, `guq`, `gvq`) and the saved `dp0`, `du0`, `dv0`. Column arrays (10 levels) are private.
- **Spectral kernels.** These run one thread per real coefficient and loop over levels.
- **Fortran order.** Every expression keeps Fortran's grouping and order.
- **Diagnostics left out.** The branches the page never enables (`nentropy`, `nenergy`, `ndiagsp`, `ndiaggp`, `nsponge`, `ndivdamp`, `ndheat > 1`, GUI and diagnostic-step output) are not ported.
- **Start-up steps.** The `nkits` start-up steps use the same kernels with `filter: false`, their own `delt` and `deltsec2`, and the `bm1` that `makebm` builds for that `delt` (verified below).
- **`mkdheat` winds.** Fortran forms `un² − u²` from winds before and after friction or diffusion. In f32 the small increment is rounded away first and the difference then cancels. `dv2uv` is linear apart from `plavor`, which cancels in a difference. So the GPU transforms the spectral increments (`zsdt·delt2`, `zszt·delt2`, with `plavor = 0`) into wind increments `du`, `dv` and uses the identical `du (2u + du) + dv (2v + dv)`. That made `stt` 50–500× closer to f64 than the f32 build.
- **Constants.** Until `SETUP` ports `initpm`/`initsi`/`makebm`, `DYNAMICS.TABLES` lists the constants by their `pumamod` names, and verification fills them from the dumps.

### Verification

`node scripts/exoplasim-webgpu/verify-dynamics.mjs [probe directory]` writes `stats/exoplasim-webgpu/kernels/dynamics.json`. For each case it loads the f64 state before a routine, rounded to f32, runs that routine's dispatch list, and compares every output with the f64 state after it. The f32 replay of the same routine from the same state is the comparator.

A field passes when RMS(GPU − f64) ≤ 2 × RMS(f32 − f64), and its count of points off by more than 10⁻⁵ × RMS is at most 2 × the f32 count + 1 (V3).

All 30 cases pass, with no device or page errors: T21 steps 100 and 2000, T42 steps 100 and 500, and the three start-up steps at each resolution, each with three routines. Start-up dumps come from `probe-kits.sh`, with points `kits<nkits>-a0`…`a4` around the start-up loop; `a1` follows `makebm`. Largest relative RMS per case, GPU / f32:

| Case | `gridpointa` | `spectrala` | `spectrald` |
| --- | --- | --- | --- |
| T21 step 100 | 2.4 × 10⁻⁶ / 2.0 × 10⁻⁵ | 7.0 × 10⁻⁷ / 7.1 × 10⁻⁷ | 9.5 × 10⁻⁷ / 5.5 × 10⁻⁵ |
| T21 step 2000 | 1.3 × 10⁻⁶ / 1.2 × 10⁻⁴ | 3.2 × 10⁻⁶ / 3.2 × 10⁻⁶ | 5.0 × 10⁻⁷ / 5.7 × 10⁻⁵ |
| T42 step 100 | 3.4 × 10⁻⁶ / 1.2 × 10⁻⁴ | 1.2 × 10⁻⁶ / 1.2 × 10⁻⁶ | 1.1 × 10⁻⁷ / 1.0 × 10⁻⁷ |
| T42 step 500 | 3.6 × 10⁻⁶ / 1.0 × 10⁻⁴ | 6.6 × 10⁻⁶ / 6.7 × 10⁻⁶ | 1.1 × 10⁻⁷ / 1.7 × 10⁻⁵ |
| T21 start-up 3 | 2.1 × 10⁻⁷ / 3.6 × 10⁻⁶ (`sdt`) | 9.1 × 10⁻⁸ / 9.1 × 10⁻⁸ | 2.1 × 10⁻⁴ / 2.1 × 10⁻⁴ (`szt`) |
| T21 start-up 2 | 2.3 × 10⁻⁵ / 2.6 × 10⁻⁴ | 9.9 × 10⁻⁸ / 9.9 × 10⁻⁸ | 2.4 × 10⁻⁶ / 1.2 × 10⁻⁵ |
| T21 start-up 1 | 7.3 × 10⁻⁶ / 1.5 × 10⁻⁴ | 1.1 × 10⁻⁷ / 1.1 × 10⁻⁷ | 6.4 × 10⁻⁷ / 4.4 × 10⁻⁷ |
| T42 start-up 3 | 2.4 × 10⁻⁷ / 4.4 × 10⁻⁵ (`sdt`) | 9.3 × 10⁻⁸ / 9.3 × 10⁻⁸ | 1.7 × 10⁻⁶ / 1.7 × 10⁻⁶ |
| T42 start-up 2 | 9.7 × 10⁻⁶ / 4.9 × 10⁻⁴ | 1.1 × 10⁻⁷ / 1.1 × 10⁻⁷ | 4.4 × 10⁻⁷ / 1.7 × 10⁻⁶ |
| T42 start-up 1 | 3.5 × 10⁻⁶ / 3.5 × 10⁻⁴ | 1.6 × 10⁻⁷ / 1.6 × 10⁻⁷ | 9.5 × 10⁻⁸ / 1.7 × 10⁻⁷ |

The first start-up step begins from rest:
- **`szt` after `gridpointa`** is essentially zero in f64 (RMS 3 × 10⁻¹⁹), so its relative errors (10⁶ GPU, 10⁸ f32) are left out of the table. In absolute terms the GPU is about 50× closer.
- **All-zero fields** (humidity, winds) pass because the GPU's are zero too.
- **`gp` is not compared after `gridpointa`** on steps where `mod(nstep, nafter) = 0`, which includes every start-up step. There Fortran overwrites `gp` with the Fourier coefficients of exp(ln ps) − 1 to compute the output-only `span`, and `invlegd` rewrites `gp` before anything reads it. The GPU skips that branch; the harness records the skip.

- **`gridpointa`.** The GPU is 3–100× more accurate than f32 Fortran for the spectral tendencies (ratios 0.003–0.13). It uses Legendre and Fourier tables computed in f64, while the f32 build computes `legini` and its FFT twiddles in f32.
- **`spectrala`.** Errors match the f32 build (ratio 1.00): both are set by rounding the inputs.
- **`spectrald`.** With wind increments, `stt` is 50–500× closer to f64 than the f32 build (ratio 0.001–0.017). Before that change it matched f32 (0.90–1.14) and failed at the first start-up step (2.59).
- **Sensitivity.** Flipping the sign of one term on the top level of `guz` in `calcgp.wgsl` failed `sdt` and `szt` at ratios of about 10⁴, and nothing else.

### Dynamics set-up port

`src/model/climate/gcm/dynamics/setup/` (`DYNAMICS_SETUP`) ports, in f64:
- **`initpm`**, for `NEQSIG = 0`, the only spacing the page writes: the sigma levels (`sigmah`, `sigma`, `dsigma`, `rdsig`) and `dayseccheck`. Values below one timestep are taken as days. Then come the nondimensional `damp`, `tfrc`, `tdissd`, `tdissz`, `tdisst` and `tdissq`, the horizontal-diffusion coefficients `sak` (`(n − nhdiff)^ndel`, normalized at NTRU), `nindex`, `spnorm`, and `t0`, `dtns`, `dtep`, `dttrp` divided by `ct`.
- **`initsi`**: `tkp`, `t01s2`, and the ECMWF-scheme matrices `g`, `c`, `tau`.
- **`makebm`**: the matrix `bm1(:, :, n)` = (1 / (n(n+1)) I + delt² B)⁻¹, inverted with the same `ludcmp`/`lubksb` partial pivoting as `minvers`.
- **`prolog`'s `rcsq`**, from `GCM_GRID`'s latitude sines.

`DYNAMICS_SETUP.tables` maps these onto `DYNAMICS.TABLES` (`sakpp` = `sak` with one process). `sop` (spectral orography) and `srp` (restoration temperature) belong to the surface and restoration set-up, which isn't ported yet. Constants follow `pumamod`: π is the parameter 3.14159265359, not `Math.PI`.

`stats/exoplasim-reference/probe-setup.sh` adds two set-up dumps: `probe-initpm-in` before `initpm` and `probe-initsi-out` after `initsi`. It runs them with the step-0 main-loop dump for four configurations:

| Case | What differs |
| --- | --- |
| `earth-t21` | page defaults, 45-minute steps |
| `earth-t42` | T42 |
| `alt1-t21` | 30-minute steps |
| `orbit-t21` | 2-day rotation, so `delt` is half |

`node scripts/exoplasim-webgpu/verify-setup.mjs` feeds the `initpm-in` values to the port and compares 25 arrays with Fortran: everything above plus `bm1`, `rcsq` and `sakpp` from the main-loop dump. Results are in `stats/exoplasim-webgpu/kernels/setup.json`.

All four cases pass a tolerance of 10⁻¹² of each array's largest value. The worst error is 2.9 × 10⁻¹⁵ (`rcsq` at T42); `bm1` reaches at most 1.4 × 10⁻¹⁵ across the three timesteps. The days-to-seconds conversion is exercised, since the page's diffusion times are in days.

`verify-dynamics.mjs` now builds its constants with this port, taking only `sop` and `srp` from the dumps. Main-loop cases give the same errors as with the dumped constants.
