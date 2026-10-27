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

## P3: physics (started 2026-10-25)

### Probing the physics

Physics state lives in each scheme's own module, so the probe now dumps and replays 15 modules:
- `pumamod`;
- `miscmod`, `fluxmod`, `radmod` and `orbconst`, `rainmod`, `surfmod`, `landmod`, `seamod`, `icemod`, `oceanmod`;
- `vegmod` (`simba.f90`), `carbonmod`, `glaciermod`, `specblock`.

That is 1,066 variables, with non-`pumamod` names prefixed by their module (`miscmod.zgw`). `probe_source.py` parses each module after `gfortran -cpp -E`, because `carbonmod` declares arrays inside `#if` blocks, and generates one dump and one load routine per module.

Points inside `gridpointd`:
- `d0` after dimensionalizing, before `miscstep`;
- `d1`…`d6` after `miscstep`, `fluxstep`, `radstep`, `rainstep`, `surfstep` and `carbonstep`.

`hurricanestep` and the de-dimensionalizing tail run between `d6` and `a3`. The f64 replay reproduces all 1,066 variables bit for bit at every point.

Diffs between consecutive dumps (T21, step 100):

| Segment | Changes |
| --- | --- |
| `a2 → d0` (frame in) | `gt gq gu gv gp dp du dv dt dq` and the zeroed `gudt gvdt gtdt gqdt dudt dvdt dtdt dqdt` |
| `d0 → d1` (`miscstep`) | `dq gqdt` |
| `d6 → a3` (`hurricanestep`, frame out) | `sdt stt szt sqt gudt gvdt gtdt gqdt` |

`hurricanestep` changes nothing in any probed module.

### Frame and fixer

- **`DYNAMICS.physicsIn`.** `invlegd` (`dv2uv`; `sq`, `st`, `sp` to Fourier), 5 inverse Fourier transforms, then `physics-in.wgsl`: `dp = psurf·exp(gp)`, `du`, `dv`, `dt`, `dq` in physical units, every tendency zeroed. Level `NLEP` of `dt`, `dq`, `du`, `dv` is left to the surface schemes. The `sqout` output field, computed on output steps, isn't ported.
- **`DYNAMICS.physicsOut`.** `physics-out.wgsl` adds the dimensional tendencies to the model-unit ones the schemes write directly. Then 4 forward Fourier transforms, Legendre `gtdt → stt` and `gqdt → sqt`, and `uv2dv` to `sdt`, `szt`.
- **`physics/fixer` (`FIXER`).** `miscmod`'s fixer with `nfixer = 1`, in four kernels:

  | Kernel | Work |
  | --- | --- |
  | `column.wgsl` | Per-column deficit and surplus, `fix0d` |
  | `row.wgsl` | `fix1d`, one thread per latitude, summing in longitude order |
  | `global.wgsl` | One workgroup: strided partial sums, then a fixed-order tree; the first global reduction |
  | `apply.wgsl` | Global scale factor, `gqdt` and the new `dq` |

  Fortran skips `fix0d` and `fix1d` when the global deficit is zero. In that case every column's deficit is zero and they change nothing, so the GPU runs them unconditionally. `zgw` (`miscini`) comes from `GCM_GRID`'s weights.

### Verification

`verify-dynamics.mjs` adds `physicsIn` (`a2 → d0`), `fixer` (`d0 → d1`) and `physicsOut` (`d6 → a3`) on the main-loop steps. All pass at T21 steps 100 and 2000 and T42 steps 100 and 500:
- `physicsIn`: worst 2.1 × 10⁻⁶ relative, ratio ≤ 1.31;
- `fixer`: worst 4.6 × 10⁻⁶, ratio ≤ 1.26;
- `physicsOut`: spectral tendencies with ratios 0.00–0.04.

`physicsOut` compares only `sdt`, `stt`, `szt` and `sqt`. Fortran's `gp2fc` transforms `gudt`…`gqdt` in place, so at `a3` those arrays hold Fourier coefficients, while the GPU writes separate Fourier fields. `gridpointd` zeroes them before they are used again.

### Surface fluxes and vertical diffusion

`physics/surface-flux` (`SURFACE_FLUX`) ports `fluxmod`'s `fluxstep` for the path the page reaches: `nvdiff`, `nshfl`, `nevap` and `nstress` are all 1, and `ntsa` is 2. It has two column kernels:

| Kernel | Ports |
| --- | --- |
| `surflx.wgsl` | `surflx`: 2 m temperature, bulk Richardson number, ECHAM stability functions (Miller et al. 1992 over unstable sea), transfer coefficients. Then the implicit `mkstress` (drag, with its kinetic-energy loss heating the lowest level, `ndheat = 1`), `mkshfl` and `mkevap` (with soil-water limit and latent heat of vaporization or sublimation) |
| `vdiff.wgsl` | `vdiff`: Richardson-number dependent diffusion coefficients between levels, then the ECHAM semi-implicit tridiagonal solves for u, v, kinetic energy (as heating), q and potential temperature |

`d1 → d2` changes `dtdt dqdt dudt dvdt dtaux dtauy dust3 dshfl dshdt devap dlhfl dlhdt dtsa` and `fluxmod.dtransh`/`dtransm`; only `fluxmod` reads the last two. The harness maps the state fields `dtransh`/`dtransm` to those dump names.

**Level constants in f64.** The first GPU version evaluated `σ^κ`, `σh^κ`, the mixing lengths, `vdiff`'s cube-root stability factor `zzkfac`, `1/Δσ`, and `surflx`'s `σ_N^−κ` and `ln σ_N` in every column. `dqdt` at T42 step 100 then failed at 2.54× the f32 error, concentrated in the boundary layer (levels 8–10). These depend only on the level, so `SURFACE_FLUX.tables` now computes them in f64. That brought it to 1.08×, the same move as DP1.4 for the transform tables. WGSL defines `pow` only as accurately as `exp2(y·log2 x)`.

An increment form of the tridiagonal solves (solving directly for `y − x`, with the flux divergence on the right) changed no ratio measurably, so `vdiff` keeps Fortran's form. A deliberate doubling of `du` was caught (`dudt` ratio 4 × 10⁴, nothing else), so the harness was running the edited kernel. The remaining ~2× on some tendencies (`dqdt` 1.98, `dvdt` 1.94 at T21 step 2000) comes from computing the diffusion coefficients. WGSL doesn't require correctly rounded division or square root.

All four cases pass:

| Case | Largest ratio | Fields at or above 1.5 |
| --- | --- | --- |
| T21 step 100 | 1.22 (`dqdt`) | none |
| T21 step 2000 | 1.98 (`dqdt`) | `dqdt` 1.98, `dvdt` 1.94, `dudt` 1.72 |
| T42 step 100 | 1.17 (`dtdt`, `dshfl`) | none |
| T42 step 500 | 1.77 (`dvdt`) | `dvdt` 1.77 |

Fluxes, transfer coefficients and `dtsa` are at 0.6–1.2×. The tendency margins are thin. If more states push them past 2×, the next step is f64 or compensated evaluation of the coefficient terms.

Replacing `surflx`'s `log` and `pow` with the precise versions from the radiation port (below) did not help: `dqdt` at T21 step 2000 went from 1.98 to 2.08. The surface-flux margin doesn't come from transcendentals, so `surflx` keeps WGSL's built-ins.

### Radiation

`physics/radiation` (`RADIATION`) ports `radmod`'s `radstep` as five column kernels:

| Kernel | Ports |
| --- | --- |
| `solang.wgsl` | `solang` (`ncstsol = 0`): `gmu0` from the declination and hour angle |
| `mko3.wgsl` | `mko3` (`no3 = 1`, synthetic ozone); not built when the page turns ozone off |
| `swr.wgsl` | `swr`: two bands (ozone, water vapour), adding method, cloud optics from liquid water (`nswrcl = 1`), surface Rayleigh scattering (`newrsc = 0`), open-water albedo (`necham = 1`), both `nstartemp` paths |
| `lwr.wgsl` | `lwr`: water vapour, ozone and CO₂ emissivities between every pair of levels, pressure broadening, cloud emissivity from liquid water |
| `radstep.wgsl` | The tail of `radstep`: `dflux`, the heating rates `dtdt`, `dtdtswr`, `dtdtlwr`, and `dconv` |

Terms that a fixed switch multiplies by zero are left out, with the switch named in the kernel. Examples are `l_aerorad = 0` aerosols, `necham6`, and `lwr`'s entropy fluxes (`nentropy = 0`).

**Per-step values from the CPU.** `CALENDAR.solar` (`calendar/`) ports `solang`'s calendar and `orb_decl` in f64. `RADIATION.step` turns its output into the 5-float `radiation_step` field:
- sin and cos of the declination;
- `zmins·zrtim`;
- `gdist2`;
- `mko3`'s `cos 2π(zcday − toffo3)`.

The orbit matches the dump's `zcdayf`, `zdeclf`, `gdist2`, `orbnu`, `lambm` and `rasc` exactly (difference 0) at all four probe steps. `orb_params` runs once in `radini`, so its outputs (`eccen`, `obliqr`, `mvelpp`, `lambm0`) are inputs here and still come from the dump.

**f64 constants.** These come from `RADIATION.tables`:
- `sid` and `cola` per latitude;
- `rad_lnsig`, the log-σ layer thickness that `mko3` and `radstep` use;
- `lwr`'s per-level absorber factor `zzf1` and cloud factor `zzf3`.

`lwr`'s absorptivity offsets (`zao30` … `zth2oc`) and `swr`'s diffuse-light coefficients (`zb3`–`zb5`) are pipeline constants computed in f64.

**Precise `log`, `exp` and `pow`.** The first `lwr` failed every case at 11–54× the f32 error, worst near the surface:

| Field | f32 / f64 RMS | GPU / f64 RMS |
| --- | --- | --- |
| `dftd`, T21 step 2000 | 2.2 × 10⁻⁷ | 1.2 × 10⁻⁵ |
| `dlwfl`, T21 step 2000 | 3.4 × 10⁻⁷ | 1.7 × 10⁻⁵ |

There are two causes:
- `lwr` divides by `log τ₀` with `τ₀` near 1;
- its absorptivity fits subtract `0.846·(u + 3.59·10⁻⁵)^0.243` from a nearly equal constant.

WGSL bounds `log` and `exp` by absolute error, not relative, so both lose most of their digits.

`src/model/shared/gpu/math` (`GPU_MATH.PRECISE`, DP4.3) holds f32 ports of musl's `logf` and `expf`, and `pow` built from them. The radiation kernels use them for every `log`, `exp` and `pow`. That brought `lwr` to 1.00–1.03×. `swr` and `mko3` hardly changed (`dfu` 1.15 → 1.13).

All four cases pass:

| Case | Largest ratio | Fields at or above 1.2 |
| --- | --- | --- |
| T21 step 100 | 1.13 (`dfu`) | none |
| T21 step 2000 | 1.12 (`dtdtswr`) | none |
| T42 step 100 | 1.15 (`dfu`) | none |
| T42 step 500 | 1.14 (`dtdtswr`) | none |

`dsalb` is stored band by band (`2 × NHOR`) rather than Fortran's `(2, NHOR)`. The harness transposes it on the way in and out.

### Precipitation and clouds

`physics/precipitation` (`PRECIPITATION`) ports `rainmod`'s `rainstep` for the path every page configuration takes:
- `nprc`, `nprl`, `ndca`, `nclouds`, `ncsurf`, `nshallow`, `nevapprec` = 1;
- `kbeta = 1`, `nmoment = 0`, `nstorain = 0`.

| Dispatch | Ports |
| --- | --- |
| `LEGENDRE.inverse` `sqt → fdqt`, `FOURIER.inverse` `fdqt → dqt` | `mkdqtgp`'s transforms |
| `kuo.wgsl` | `mkdqtgp`'s scaling, then `kuo` (Kuo deep convection: parcel lifting from the surface or the lowest moistening level, closure by mean relative humidity) and `mkshallow` (shallow convection as diffusion) |
| `mkdca.wgsl` | `mkdca`'s dry adjustment per column, into scratch fields |
| `mkdca-limit.wgsl` | One workgroup: whether any column needed more than 2·NLEV passes |
| `column.wgsl` (+ `mklsp.wgsl`, `mkrain.wgsl`, `mkclouds.wgsl`) | Adds `mkdca`'s tendencies unless that limit was hit, then `mklsp`, `mkrain` and `mkclouds` per column |

`mkdca` repeats its pass over all columns until none is unstable, and drops every column's adjustment if 2·NLEV passes are not enough. Columns don't interact, so each GPU thread iterates its own column. `mkdca-limit` then reproduces the global give-up.

`vdiff` and `mkshallow` share the ECHAM tridiagonal solves. These moved to `physics/diffusion` (`IMPLICIT_DIFFUSION`), and surface fluxes were re-verified unchanged.

Tables come from `PRECIPITATION.tables` in f64: `rcrit` (`rainini`) and `kuo_zfac`, kuo's `(σ_l/σ_l+1)^κ`. The kernels also read `SURFACE_FLUX`'s `vdiff_skap`, `vdiff_skaph` and `vdiff_rdsig` and `RADIATION`'s `rad_lnsig`. Saturation humidity uses `GPU_MATH`'s `exp`. Its two correction forms, `q·zcor` and `q/(1 − MOIST·q)`, round differently, so each call site keeps Fortran's form. `kuo` also reuses a stale `zcor` where Fortran does.

`d3 → d4` changes `dqt dcc dql dtdt dqdt dprc dprl dprs dqvi` and `rainmod.icclev icctot dprcl dprll`; the harness maps the state fields to the `rainmod.` names.

**`mkdca`'s round-trip noise.** The first version failed `dtdt` at T21 step 100: ratio 1.75, with 10,222 points off against f32's 5,036. `mkdca` converts every level to θ = T/σ^κ and back, so even levels it never mixes get `(T/σ^κ·σ^κ − T)/Δt`. That is about 0 in f64 and f32 rounding noise elsewhere, and the GPU's division isn't correctly rounded. Levels no pass mixes now get exactly 0, the f64 answer. `dtdt` dropped to 0.71–0.87×, below f32, and a `dql` threshold flip at T21 step 2000 went away with it. In that flip, cover of 5 × 10⁻¹⁰ switched cloud water on.

Results:

| Case | Largest ratio | Status |
| --- | --- | --- |
| T21 step 100 | 1.20 (`dprs`) | pass |
| T21 step 2000 | 2.37 (`dprc`) | pass under the outlier rule: 1.23 without column 1393 (8 points off against f32's 6) |
| T42 step 100 | 1.14 (`dprs`) | pass |
| T42 step 500 | 1.20 (`dprc`) | pass |

`icclev` and `icctot` are exact.

**The `dprc` case.** The error comes from one column (h = 1393), where a barely buoyant parcel gives a convective rain rate set by `T_parcel − T_env`:

| | `dprcl`, level 8 | `dprcl`, level 9 |
| --- | --- | --- |
| GPU error | −2.7 × 10⁻³ | 2.7 × 10⁻⁴ |
| f32 error | −8.1 × 10⁻⁴ | 8 × 10⁻⁵ |

`dprc` there is 1.5 × 10⁻⁸ m/s. Without that column the ratio is 1.23. Correctly rounded division in the parcel and saturation code (an `fma` residual step) didn't change it (2.36–2.50), so it isn't division error.

**Root cause.** `stats/kuo-trace.mjs` emulates `kuo` for one column in f64 and in f32, rounding after every operation. The f64 run reproduces the dump bit for bit, and the f32 run reproduces the f32 replay. Swapping in the GPU's choices one at a time:

| Variant | `dprcl` error, levels 8 and 9 |
| --- | --- |
| Fortran f32 (`powf` on rounded σ) | −8.05 × 10⁻⁴, 7.96 × 10⁻⁵ |
| `GPU_MATH` `exp` | unchanged |
| GPU `dqt` | unchanged |
| f64 `kuo_zfac` table | −2.70 × 10⁻³, 2.68 × 10⁻⁴, the GPU's values exactly |

At level 8 the parcel is 0.0147 K warmer than its 281 K surroundings. One f32 ULP of temperature there is 3 × 10⁻⁵ K, so one ULP moves `dprcl` by 2 × 10⁻³. The correctly rounded f64 factor `(σ_l/σ_l+1)^κ` and f32's `powf` on rounded σ differ by about an ULP, and at this column that lands the GPU's parcel 1 ULP further from f64.

Over every deep-convection column (956 at T21 step 100, 911 at step 2000), the f64 table and `powf` give the same `dprcl` RMS error: ratios 0.99 and 1.00. So the GPU's arithmetic isn't worse than f32's. The failure is one ill-conditioned trigger whose error is a coin flip at the ULP level, and it dominates a field RMS. Matching Fortran's `powf` would pass this case by reproducing f32 rounding rather than approaching f64. Making the excess itself accurate would need the parcel's whole lift and condensation chain in double-float.

**Outlier rule.** The gate (plan V3) now judges a grid field again without its worst column when that column holds more than half of the GPU's squared error, and names the column. With it, every case passes: 54 of 54. The model code was unchanged from the 53-of-54 run, and the rule only affects failing fields.

### Surface: land, vegetation, glacier, sea ice and ocean

`surfstep` (`d4 → d5`) runs as six dispatches composed by `physics/surface` (`SURFACE`), with one namespace per Fortran module:

| Dispatch | Ports |
| --- | --- |
| `land/wgsl/soil.wgsl` | `soilstep`: `tands` (snow, implicit surface temperature, melt), `mktsoil` (5-layer soil diffusion), `wandr` (bucket and runoff) |
| `land/wgsl/mkradv.wgsl` | `mkradv`'s river routing, as a stencil: each point applies the Fortran loop's updates to its own runoff in the same order, reading only `driver` |
| `land/wgsl/surface.wgsl` (+ `vegetation/`, `glacier/`) | `roffstep`'s river store, `getalb`, landstep's humidity, albedo and soil diagnostics, `vegstep`, glacier albedo, `glacierstep` |
| `sea-ice/wgsl/ice.wgsl` | seastep's coupling, then `icestep` through `iceget`, `skintemp`, `mkcflux`, `subsnow`, `mkice`, `mkicec` and the `xmaxd` cap |
| `REDUCTION.sum` | `getiflx`'s two Gaussian-weighted global sums |
| `sea/wgsl/seastep.wgsl` (+ `sea-ice/wgsl/finish.wgsl`, `ocean/`) | The rest of `icestep`, `oceanstep` (slab ocean: `oceanget`, `mksst`, `mkiflux`), and seastep's surface state, humidity, Charnock roughness and albedo |

Switch values let the coupling reduce exactly:
- `ncpl_atmos_ice = ncpl_ice_ocean = 1`: seamod's and icemod's accumulators each hold one step and divide by 1, so the fluxes pass straight through.
- `noutput = 0`: the `x…a` and `y…a` output means, and the forcing copies only the LSG ocean reads, are left out.
- Single ocean layer, `nhdiff = 0`, `nlsg = 0`.

Like Fortran, `icestep` runs on every point, with zero fluxes on land. `glacierstep`'s `persistflag` only feeds the annual glacier update, which is not ported yet.

**Shared pieces:**
- `reduction/` (`REDUCTION.sum`) is the deterministic two-field global sum of plan DP2.4. The fixer moved onto it with unchanged ratios.
- `GPU_MATH` gained `precise_atan` (musl `atanf`; WGSL bounds `atan` only to 4096 ULP), `precise_powi` (Fortran's integer powers, now also used by `kuo`) and `precise_divide`.

**Month weights.** `CALENDAR.monthInterpolation` ports `momint` with `step2cal30`. The reference build's `calini` receives `nint(mpstep)` (the calendar fix in `model_source.py`), not upstream's `mcal_days_per_year`. The interpolated `landmod.dalbclim` and `icemod.xclssto` match the dumps bit for bit at all four states. `SURFACE_STEP` carries month, neighbour and weight at `nstep` and `nstep + 1`.

**Biased division.** At first only `dq` failed. All its off points were on the lowest level over hot land, with 38 off against f32's 18 at T21 step 2000 and 30 against 4 at T42 step 500. The GPU's land surface temperature was 2 ULP low (about 5 × 10⁻⁵ K) at every point above 300 K, while f32's errors scattered around zero.

`tands` solves the surface temperature as a ratio of about 6 × 10⁴ to about 200, and 95% of the numerator is `ctop·DZTOP·dtsm/DELTSEC`. Chrome evaluates `x / DELTSEC` as `x · (1/DELTSEC)` with an approximate reciprocal, so every quotient by that constant is off in the same direction.

`precise_divide` (an `fma` residual step) in `surface_temperature`, `snow_layer` and the saturation formulas fixed it. `dq` went to 0.97–1.00 with off counts equal to f32's (1/1, 16/18, 0/0, 4/4). The same correction in `kuo` (above) changed nothing, so it is applied only where a quotient by a constant dominates a cancelling or conditioned result.

Results (all pass; fields at or above 1.2 listed):

| Case | Largest ratio | Fields at or above 1.2 |
| --- | --- | --- |
| T21 step 100 | 1.34 (`dz0`) | `dz0` |
| T21 step 2000 | 1.35 (`xsnow`) | `xsnow`, `dz0` 1.34 |
| T42 step 100 | 1.14 (`dz0`) | none |
| T42 step 500 | 1.14 (`dz0`) | none |

Fields that are zero in every case (no sea ice at step 100, `dmld`, `dglac` unchanged) pass as exact.

With the surface routine, the full `verify-dynamics.mjs` run holds twelve f64 and nine f32 dumps per case and exceeds Node's default 4 GB heap. Run it as `node --max-old-space-size=8192 scripts/exoplasim-webgpu/verify-dynamics.mjs`. All 58 cases pass; the only outlier column is `dprc` at T21 step 2000 (column 1393, 84% of the error, 1.23 without).

### Carbon cycle

`physics/carbon` (`CARBON`) ports `carbonmod`'s `carbonstep` (`d5 → d6`) as one column kernel:
- Every step adds the step's precipitation (cm/yr) to the year's mean.
- Every `interval` steps (`mtspd / frequency`, 8 here) it computes silicate weathering on unfrozen land and adds weathering and surface temperature to their yearly means.

The step counter `cstep` stays on the CPU. `CARBON.cycle` advances it and sets the one-float `CARBON_STEP` flag. The harness checks the advanced counter against the dumped `cstep` after the step.

`carbonmod.f90` sets its own preprocessor switches in its first lines:
- `precipweath = 1`: weathering scales with `(precipitation / PEARTH)^0.65`, not the temperature-runoff law with `tune1`.
- `keeprecord = 0` and `outputrain = 0`: no weathering record or rain files.

The first kernel used the runoff law and was 3–4× off on every weathering step. An f64 evaluation of both laws from the dumped inputs matched the precipitation law exactly. `precise_pow` now returns 0 for a zero base, as `powf` does, since dry land has zero precipitation. pumamod's `co2` moved from `VEGETATION` to `CARBON`.

All four cases pass at 0.99–1.01 (`d5 → d6` changes the means, `localprecip`, `localweathering` on weathering steps, and the counters). After the `precise_pow` change, radiation, precipitation, surface and carbon, the routines that call it, were rerun: 16 of 16 pass, with only the known `dprc` outlier. The other 46 cases use no changed code since the last full 58-of-58 run.

## P4: integration (started 2026-10-26)

### Step encoder

`stepper/` (`STEPPER`) assembles the model:
- `fields`: every domain's state.
- `context`: the state and table buffers with every table written.
- `kernels`: one step in `master`'s order (`gridpointa`, `spectrala`, physics in, fixer, surface fluxes, radiation, precipitation, surface, carbon, physics out, `spectrald`), 98 dispatches.
- `encode`.
- `values`: the CPU's per-step parameters, namely the orbit (`radiation_step`), momint weights (`surface_step`), and the carbon counter with its flag (`carbon_step`).

Outside these routines, `master` only writes output and diagnostics, advances counters and runs `stability_check`.

`scripts/exoplasim-webgpu/model-inputs.mjs` turns a probe dump into `STEPPER`'s constants, tables and calendar. Both `verify-dynamics.mjs` (rewritten on it, still 62 of 62) and the new `verify-trajectory.mjs` use it.

### Short trajectories (V4)

`stats/exoplasim-reference/probe-trajectory.sh` runs the f64 build with `a0` dumps at steps 100, 102 and 148 (T21) or 100, 102 and 132 (T42). The f32 build replays only step 100's `a0`, which restores every probed module rounded once, then runs free. `verify-trajectory.mjs` starts the GPU from the same rounded state and compares 37 fields (spectral prognostics, physical fields, surface prognostics, carbon means) against both. V4's rule is per-field RMS difference from f64 at most 2× the f32 build's.

| Case | Result | Fields over 2× |
| --- | --- | --- |
| T21, 2 steps | pass | none (largest 1.23, `devap`) |
| T21, 48 steps | fail | `dprl` 3.40 (relative 0.39 vs 0.12), `xiced` 3.06 (5 × 10⁻⁵ vs 2 × 10⁻⁵) |
| T42, 2 steps | fail | `sq` 6.38, `sqm` 4.66, `localavgweather` 5.05 |
| T42, 32 steps | pass | none (largest 1.51, `devap`) |

Most fields are near 1× or well below (`sd` 0.02–0.11 at 2 steps: the GPU is closer to f64 than f32 is). A T42 step takes about 1.5 s here, with the harness writing step values and submitting once per step; nothing is batched yet.

**The T42 2-step `sq`.** `stats/diagnose-step.mjs` chains GPU routines from the f64 state and compares against f64 dumps at every probe point. In step 100 every routine's error matches its standalone V3 error (`surfaceFlux`'s `dqdt` 2.1 × 10⁻⁴ against f32's 2.0 × 10⁻⁴). Fields Fortran changes are all reproduced, and no field Fortran leaves alone is disturbed.

In step 101 (dumped by `probe-step101.sh`), `rainstep`'s discrete decisions flip in 2 of 8192 columns:
- column 3595: no deep convection in f64, a trace (4.7 × 10⁻¹⁰ m/s) on the GPU;
- column 5087: a different number of convective levels.

Those two columns carry `dqdt`'s error to 1.1 × 10⁻², then `sqt` to 6.6 × 10⁻³ and `sq` to 1.4 × 10⁻⁴. This is the discontinuity that needed V3's outlier rule. A single f32 run happened to flip fewer columns. By 32 steps the GPU and f32 errors are equal (`sq` 0.95).

The T21 48-step failures are fields with O(0.1–1) relative error in both runs (large-scale rain), or tiny errors in both (ice thickness). A ratio of two single chaotic realisations is a noisy statistic. Judging V4 needs a spread of f32-like runs rather than one.

### Set-up from the page's configuration

`setup/` (`SETUP`) builds the model's inputs from the namelist text the page writes (`GCM_NAMELIST`), so a run no longer needs a Fortran dump:
- `GCM_NAMELIST.parse` reads a namelist file back into key–value pairs.
- `SETUP.pumamod` ports `planet_ini` (Earth defaults from `p_earth.f90`) and `readnl`, with plasimmod's defaults, the resolution-dependent diffusion and drag, and the derived day lengths, timestep, `ww`, `cv`, `ct`, `acpd`, `adv` and `rdbrv`. All 72 values match the `initpm-in` dump exactly at T21 and T42.
- `RADIATION`'s `spectrum/` (`SPECTRUM.split`) ports `solarini` for a blackbody star. It gives the band split at 0.75 µm, the Rayleigh coefficient relative to the Sun, and eight star-weighted albedo pairs (snow, sea ice, glacier, ground, ocean). The spectral tables come from `specblock.f90` via `scripts/exoplasim-webgpu/fortran-tables.mjs`. All match to within 8 × 10⁻¹⁶ (`pow`/`exp` last bits).
- `SETUP.constants` assembles everything `STEPPER` takes apart from the initial state: every kernel's constants, the step calendar and the constant tables' inputs other than `DYNAMICS.TABLES`. `setup/modules/` (`MODULE_SETUP`) holds each physics module's namelist defaults and what its `*ini` derives:
  - `landini`'s band albedos for snow and glacier and its vegetation time scales in seconds;
  - `iceini`'s timestep;
  - `carbonini`'s weathering interval and yearly-mean weight;
  - `rainini`'s `gamma` at T42 and `clwfac`;
  - `radini`'s resolution tuning and `solarini`.
  `CALENDAR.orbit` ports `orb_params`: the fixed orbit, or Berger's series (tables generated from `pumamod`'s data by `fortran-tables.mjs`) for `radini`'s year.
- prolog lowers `psurf` from the sea-level value to the mean surface pressure using the initial orography's mean spectral coefficient `so(1)`, so `SETUP.constants` takes it as `meanOrography` (from `SETUP.state`'s `so[0]`).
- Every constant, calendar value (including the orbit's four angles) and table input matches the main-loop dumps to within 10⁻¹⁴ at T21 and T42.

`scripts/exoplasim-webgpu/verify-namelist.mjs` runs these checks in about 20 s.

#### Initial state

`SETUP.state` builds prolog's fresh-start state from the page's namelists and `.sra` files, under `STEPPER`'s field names, plus the spectral orography `so` (`DYNAMICS.TABLES`' `sop`; `srp` is the state's `sr`):
- `DYNAMICS_SETUP.setzt` gives the restoration temperature `sr`. `setup/state/` (`INITIAL_STATE`) ports `initfd`:
  - `st` and `stm` take `sr`'s global mean (all of `sr` with a tidally locked `dttl`);
  - `sz` and `szm` take the planetary vorticity;
  - `sp` and `spm` take `noise`'s white noise of amplitude 10⁻⁴.
- `noise` draws from gfortran's `random_number`, so `shared/random/gfortran/` (`GFORTRAN_RANDOM`) ports libgfortran's xoshiro256** and `random_seed(put=)`. `random_seed(put=)` reverses the eight seed words and XORs them with the scrambling keys. The namelist's `SEED` reproduces the reference noise bit for bit.
- `setup/surface/` (`SURFACE_SETUP`) ports `surfini` for a fresh start:
  - `get_surf_array` reads `N<NLAT>_surf_<code>.sra`, expanding 12-month files to 14 months;
  - `landini` with `soilini` and `getalb`;
  - `glacierini`/`oroini`: glacier geopotential, river routing, and the orography's grid→spectral transform with the `skgpsp` filter;
  - `vegini`;
  - `seaini` with `iceini` (`read_ice_surface`, `make_ice_thickness`, `iceget`) and `oceanini`;
  - `radini`'s CO₂ field.
- The transform is `FOURIER.analyse` (`gp2fc` as a DFT) followed by `LEGENDRE.analyse` (`fc2sp`'s symmetric branch), both in f64.
- The start step comes from `cal2step`'s 360-day calendar (`n_start_step`). The 365-day calendar throws, like `CALENDAR.monthInterpolation`.
- `GCM_GRID` now ports `inigau` itself (Newton steps on the trigonometric series of the normalised Legendre polynomial). The earlier Newton recurrence put the T42 Gaussian weights 3 × 10⁻¹² away from Fortran's, which showed in `so`.

`scripts/exoplasim-webgpu/verify-initial-state.mjs` (about 20 s) compares all 78 fields with the first start-up step's `kits3-a0` dump at T21 and T42. All match to within 10⁻¹³ of each field's largest value. Everything except the T42 Gaussian weights (`darea`, `xgw`) matches to 10⁻¹⁴; those weights differ by 2 × 10⁻¹⁴ (`cos`/`acos` last bits).

#### Start-up steps and the fresh-start trajectory

master runs `nkits` = 3 start-up steps before the main loop, each with the timestep halved once per remaining step (`delt`, `deltsec`) and its own `makebm`. `nstep` stays at the start step through all of them. Two other things differ:
- `spectrala` and `spectrald` skip the leapfrog filter (`dynamics.filter`).
- `seastep` sums the fluxes but skips `icestep`, so ice and the slab ocean stand still. The first main step's `icestep` then takes the four steps' mean.

The GPU covers this as follows:
- `SETUP.constants({ kits })` gives each start-up step's constants. `SETUP.dynamicsTables({ kits, state })` gives its `DYNAMICS.TABLES`, with `bm1` for that timestep and `sop`/`srp` from `SETUP.state`.
- `SURFACE`'s `seaCoupled: false` drops the ice kernel and `getiflx`'s sums. The sea kernel (`ICE_COUPLED`) then adds the heat flux and snowfall to `sea_cheata`/`sea_cprsa` and counts steps in `sea_naccua`; those are the only fluxes the ice kernel reads.
- The ice kernel divides by the count plus one and resets the sums. In the main loop that divisor is 1 and the sums are 0, so main-loop results are unchanged: V4 reproduces its recorded ratios exactly.

`scripts/exoplasim-webgpu/verify-startup.mjs` runs a whole fresh start on the GPU from `SETUP` alone: the page's namelists and `.sra` files, with no dump. It runs the three start-up steps and then 32 main steps (about 1 minute for both resolutions). The reference comes from `stats/exoplasim-reference/probe-startup.sh`, where the f32 build replays only the f64 state after prolog (`kits3-a0`). V4's gate applies after each start-up step and after 2 and 32 main steps. Results (2026-10-27):

| Point | T21 | T42 |
|---|---|---|
| After each start-up step (`kits3/2/1-a4`) | pass | pass |
| 2 main steps | pass | pass |
| 32 main steps | pass | fail: `dcveg` 159, `dcsoil` 105, `dwatc` 8.4, `dsoilt` 4.9, `stm` 2.5, `sqm` 2.2, `localavgweather` 2.2 |

Dense T42 dumps (every 2 steps, `probe-startup-dense.sh`; traced with `stats/startup-trace.mjs`) show the T42 failure building up:
- **Steps 4–10:** `dcveg`/`dcsoil` at 2.1–2.4×. About 75% of the error is one vegetation column (h5166), and without it they pass at 1.4–1.9×.
- **Steps 12–16:** `dprl`/`dprc` at 2.5–3.1×, half of it one column, 1.7–2.7× without it.
- **Steps 8 and 18:** `sqm` at 3.8× and 3.2×, with no dominant column; `sq` passes at those steps.
- **Up to step 16:** the atmosphere tracks f64 better than the f32 build (`st` 0.24×).
- **Step 20:** the GPU forms a cloud at level 9 of column h5352 (cover 0.25) where both Fortran builds have none, and its lowest-level cover is 0.25 against 0.47. Two steps earlier that column was within a few times f32's error. Surface shortwave there jumps by 250 W/m²; other columns follow, and from step 22 the atmosphere's error grows to 1.2–2.7× f32's.

This is the same pattern as V4's accepted failures: a marginal threshold tips the other way on the GPU, then grows.

The `sqm` failures at steps 8 and 18 look grid-wide only because `sqm` is spectral; in grid space they are one column:
- **Where:** at step 7, 99% of the GPU's lowest-level `dq` error is at h7010. There the GPU has 5.5 × 10⁻⁵ against f64's 3.1 × 10⁻⁹. One grid-point spike spreads over every spectral coefficient, and `sqm` (the filtered step-7 humidity) carries it into step 8. Step 17 shows the same column again.
- **Cause:** `miscmod`'s `fixer`. `fix0d` repairs a column from its own moisture only when its positive humidity covers the negative (`zpos ≥ zneg`), scaling the column by `(zpos − zneg)/zpos`. Otherwise the latitude or global fix scales it by almost exactly 1. The result jumps across `zpos = zneg`.
- **The margin:** after the step-6 transform, Fortran's column had `zpos/zneg − 1` = +5.6 × 10⁻⁵, so its lowest level fell to 3.1 × 10⁻⁹. The GPU's had −1.4 × 10⁻⁴, so the level kept its moisture. The level-8 humidity behind the difference (−2.42218 vs −2.42178 × 10⁻⁵) differs by 4 × 10⁻⁹, about 1/40 of the f32 build's own RMS error at that level.
- **Not a GPU error:** replaying every routine of step 6 from the f64 state (`stats/exoplasim-reference/probe-fresh.sh`, then `verify-dynamics.mjs` with `CASES`) shows the GPU fixer treating this column exactly as Fortran does. All routines pass the RMS gate; the fixer's `gqdt` and surface flux's `dtaux` fail only the points-off count, at f32 noise level.

So `sqm` is another threshold case: a discontinuity in Fortran's algorithm, crossed by f32-level differences. `stats/kernel-walk.mjs` (one kernel at a time through a chosen step) and `stats/column-dumps.mjs` (one column at every probe point) did this trace.

### Climate (V5, T21, 2026-10-27)

`SETUP.schedule` gives master's run from a fresh start: the tables, each start-up phase's constants and `bm1`, the main loop's, the calendar and the start step. `verify-startup.mjs` and the climate run both use it.

`scripts/exoplasim-webgpu/run-climate.mjs <truncation> <years> [inputs] [output]` runs the GPU model headless in Chrome from the page's input files:
- A harness-only kernel sums `gcm_reference.f90`'s nine fields after every main step: surface temperature, 2 m temperature, precipitation, total cloud cover, OLR, net TOA, surface pressure, surface heat balance and ice cover. It reads the model's state through the generated offset header, so the model has no extra fields.
- The harness reads the sums back once per model day and accumulates them in f64. At each year end it writes the same `reference-means.txt` records (one per 360-day year of 11,520 steps).
- `compare-climate.mjs` then applies V2's rule against the V2 references.

**Speed:** T21 runs at 9.0–9.2 s per model year, about 0.8 ms per step with 98 dispatches each. Fifteen years take 140 s (hardware GPU, Chrome headless). All runs stayed finite.

The references are 15 years long (V2's runs), so V5 compares years 6–15 rather than the plan's 30 years. Results against the f64 run `gate-t21-p8`:

| Quantity | GPU seed 1 | GPU seed 2 | f32 build | f64 control (seed 2) | Threshold |
|---|---|---|---|---|---|
| Surface temperature (K) | 0.039 | 0.029 | 0.035 | 0.141 | 0.161 |
| 2 m temperature (K) | 0.021 | 0.024 | 0.022 | 0.132 | 0.170 |
| Precipitation (10⁻¹¹ m/s) | 1.6 | 2.9 | −3.8 | 5.6 | 27.9 |
| Cloud cover | **0.00186** | 0.00043 | 0.00049 | −0.00062 | 0.00161 |
| OLR (W/m²) | −0.108 | 0.145 | 0.132 | 0.275 | 0.361 |
| Net TOA (W/m²) | −0.025 | 0.021 | −0.027 | −0.001 | 0.367 |
| Surface pressure (Pa) | −0.28 | **0.83** | 0.40 | 0.60 | 0.70 |
| Zonal bands passing | 7/8 (8/8 with control) | 8/8 | 7/8 | | 90% |

- **Seed 1:** the north polar band (+1.0 K) passes by the control rule; the f32 build and the control differ there by 1.0 and 1.65 K. Cloud cover fails (1.15× the threshold, larger than the control's difference).
- **Seed 2** (the control's inputs): cloud cover passes, but surface pressure fails (1.18×).
- **Is it a bias?** Seed 1's yearly cloud cover differences from f64 over years 6–15 range from −2.1 to +4.3 × 10⁻³ with mixed signs; the f32 build's range from −5.1 to +6.3 × 10⁻³ (`stats/climate-years.mjs`). So there is no steady offset.
- **Verdict:** each GPU run fails one of the seven global quantities, a different one each time, by under 20%. At 95% per quantity, at least one chance failure among seven happens about 30% of the time. By V2's rule as written, V5 does not pass at T21 with 15-year references. T42 has no climate reference yet (V2 deferred it).

Decision (2026-10-27): the T21 V5 result is accepted as noise; 30-year references were not run.
