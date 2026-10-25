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
