# ExoPlaSim WebAssembly experiment

This isolated experiment builds the actual ExoPlaSim Fortran model for Chrome, either serial or split across Web Workers that share memory (see [Shared-memory ranks](#shared-memory-ranks)). It does not connect ExoPlaSim to the application's climate engine. Build products, logs, input data, and run reports live in the ignored `stats/exoplasim-wasm/` directory.

## Reproduce on Windows with Ubuntu WSL and Chrome

For step-by-step build instructions, including the `/gcm` page assets and every build and runner option, see [scripts/exoplasim-wasm/README.md](../../scripts/exoplasim-wasm/README.md). Run from the repository root:

```powershell
wsl -d Ubuntu -- bash scripts/exoplasim-wasm/setup.sh
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --output stats/exoplasim-wasm
node scripts/exoplasim-wasm/run-browser.mjs 48
```

The setup installs portable tools under `/var/tmp/chaos-exoplasim-wasm/` in Ubuntu. It uses patched Flang 19.1.7 from the conda-forge emscripten label, an unpatched native Flang 19.1.7 environment, a separate Emscripten 4.0.9 environment, Binaryen 123, and the matching Flang runtime sources. The separate environments avoid conflicting LLVM dependencies. No application packages are installed or changed.

The source is pinned to ExoPlaSim commit `5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff`. Configuration is serial T21 (64 longitude × 32 Gaussian latitude points), 10 atmospheric layers, double precision, 30-minute timesteps, and the shipped T21 boundary data. Seed values are `14963991,2,3,4,5,6,7,8`. The initial smoke run takes 48 timesteps, or one model day. A different step count can be supplied to the browser runner. Each run starts from the packaged initial conditions.

The harness starts a loopback-only HTTP server, launches installed Chrome through the existing Playwright dependency, and runs the model in a Web Worker. It checks successful exit, requested step count, grid shape, finite returned fields, browser errors, and main-thread timer activity. It saves full diagnostics, six fields per grid cell, a screenshot, and a concise summary. The server and browser close after the check.

To build and run the equivalent native reference, then compare it with the browser:

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --target native --output stats/exoplasim-wasm
node scripts/exoplasim-wasm/run-browser.mjs 48
```

The reference uses the same Flang version, precision, configuration, seed, source adjustments, and diagnostic field extraction. The summary reports maximum absolute differences for each field when the native and browser step counts match. Native timing includes process startup; browser simulation timing excludes module loading and includes execution through normal program shutdown. These are not identical timing boundaries.

## Original scalar baseline

Chrome 155 on the development machine, optimized Wasm, serial T21, 10 layers, double precision:

| Check | Result |
| --- | --- |
| One model day (48 steps) | 3.31 seconds; native reference 1.77 seconds |
| Ten model days (480 steps) | 28.37 seconds |
| Initial Wasm linear memory | 128 MiB, including the 64 MiB stack; no growth during either run |
| Download payload without compression | 3,622,862 bytes Wasm + 2,294,096 bytes boundary data + 75,538 bytes JavaScript |
| Largest surface-temperature difference after one day | 1.85 × 10⁻¹¹ K against native |
| Largest surface-pressure difference after one day | 8.73 × 10⁻¹¹ Pa against native |
| Browser main-thread activity | 2,845 timer callbacks during the ten-day run |
| Returned fields | All six fields finite at all 2,048 grid points in both runs |

The ten-day rate extrapolates to roughly 17 minutes per 360-day model year. This is a throughput estimate from a short run, not a measured annual or equilibrium run. Module loading took about 50 milliseconds from localhost; network download latency is excluded. Startup and shutdown are included in simulation timing. The one-day native comparison checks 12,288 returned values; it does not validate every internal field or a long-run climate distribution.

Original outputs are preserved under `stats/exoplasim-wasm/baseline/`: `summary-48.json`, `summary-480.json`, `browser-48.json`, `browser-480.json`, `native-result.json`, and `native-fields.txt`. Full browser reports contain diagnostic text and returned values. The PNGs are diagnostic page captures, not climate maps.

## Optimization results

The default build uses a guarded bulk fill for contiguous double-precision arrays assigned a scalar. It retains scalar model code generation at `-O2`, the validated Fortran lowering, portable Wasm math, and all original simulation settings.

Three interleaved ten-day baseline/optimized pairs in fresh Chrome processes, without profiling:

| Build | Run times (seconds) | Median |
| --- | --- | --- |
| Original runtime | 26.960, 27.431, 27.106 | 27.106 s |
| Bulk-fill runtime | 20.598, 20.480, 20.517 | 20.517 s |

This is 1.321× throughput, or 24.3% less elapsed simulation time. All 12,288 returned numeric values match the saved ten-day baseline exactly in every optimized repeat. One-day output also retains the original native agreement. Wasm linear memory remains 128 MiB. Extrapolating the optimized ten-day median gives about 12.3 minutes per 360-day model year; an annual run was not measured.

An exploratory SIMD-candidate Chrome profile attributed 31.4% of sampled Wasm execution to generic Fortran assignment, 17.8% to `pow`, 12.5% to `gridpointd`, and 15.0% to short/long-wave radiation routines themselves. The optimized scalar profile attributes 21.4% to `gridpointd`, 12.3% to assignment, 11.7% to `pow`, and 16.9% to radiation routines themselves. Compiler settings differ between those profiles; the interleaved scalar timing pairs above isolate the runtime change. These are sampled self times, excluding time attributed to callees. Profiling runs are separate from the timing comparisons because profiling adds substantial overhead.

The runtime already handles allocation, reallocation, shape/type validation, finalization, and aliasing before its element-copy loop. The new branch follows those checks and only fills contiguous real arrays with matching eight-byte elements and a scalar RHS. It reads the RHS value before storing. Strided arrays, character padding, other precisions/types, array-to-array copies, and derived types retain their existing paths. This removes repeated descriptor indexing and tiny `memmove` calls without altering arithmetic.

`runtime-check.f90` checks contiguous fills, strided and reversed sections, scalar aliasing, signed zero, allocation/reallocation, single precision, and character padding against both runtimes:

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-runtime.py
```

Other measured candidates were excluded from the default:

- SIMD plus LLVM/linker `-O3` generated vector instructions but took 30.887 seconds in its ten-day check, with identical numeric output.
- Applying Flang frontend `-O3` reduced generic assignment call sites in the main module from 360 to 61, but produced NaNs in the browser check.
- Emscripten host JavaScript math took 21.162 seconds with bulk filling and diverged from the reference trajectory after ten days (maximum surface-temperature difference 11.24 K). It failed the comparison and is not enabled.

The failed frontend/host-math modes are not exposed by the final build script. SIMD remains available as `--variant simd` for future hardware/compiler experiments; the default is `--variant scalar`. `--assignment generic` selects the original runtime for comparison. `--profile` retains function names for CPU sampling without changing the optimization level.

Preserved original artifacts are under `stats/exoplasim-wasm/baseline/`. The repeated-run comparison is `stats/exoplasim-wasm/optimization-comparison.json`; exact reports are listed there. Candidate output and profiles remain under `simd/`, `optimized/`, `host-math/`, and `bulk/`. Stats stay local and ignored by Git.

The browser runner accepts `EXOPLASIM_OUT`, `EXOPLASIM_REFERENCE`, and an alphanumeric `EXOPLASIM_RUN` label, saving separate reports instead of overwriting earlier runs. `EXOPLASIM_PROFILE=1` records a Chrome CPU trace and sampled hotspot summary; omit it for timing. For example, after building into `stats/exoplasim-wasm`:

```powershell
$env:EXOPLASIM_REFERENCE = 'stats/exoplasim-wasm/baseline'
$env:EXOPLASIM_RUN = 'verification'
node scripts/exoplasim-wasm/run-browser.mjs 480
```

Reference checks require the same final step, grid, layers, and six finite fields per cell. The per-value error budgets are 10⁻⁶ K for temperatures, 10⁻⁶ m/s for winds, 10⁻⁴ Pa for pressure, and 10⁻¹⁰ for specific humidity. These are engineering tolerances well below useful physical resolution, intended to detect numerical changes without requiring cross-toolchain bitwise agreement. The accepted bulk-fill change produces zero observed error against the scalar browser baseline.

## Shared-memory ranks

ExoPlaSim already decomposes the grid by latitude for MPI. `--ranks N` builds one Wasm module per rank count (`NPRO_ATM = N`) and replaces `mpimod.f90` with `mpimod_shm.f90`, which calls the collectives in `library_shm.js`. Each rank is a separate Web Worker with its own Wasm instance, Fortran runtime, and file system, matching MPI process semantics without making Flang's runtime thread-safe. The ranks share one `SharedArrayBuffer`: a 64-byte control block and two alternating 8 MiB exchange regions.

Every collective writes its contribution into the current region, passes one sense-reversing `Atomics` barrier, and reads what it needs. The two regions alternate, so the next collective never overwrites data that a slower rank is still reading, and one barrier per collective suffices. Multi-level calls (`mpgallsp`, `mpsumsc`, `mpgagp`, `mpscgp`, and the other per-level loops in upstream `mpimod.f90`) exchange all levels at once instead of one MPI call per level. Reductions sum in rank order, so results are deterministic for a given rank count. A barrier spins for `EXOPLASIM_SPIN` loads (default 20,000) before sleeping in `Atomics.wait`. A failed rank sets an abort flag that wakes and stops the others.

The parallel build uses upstream `utilities.f90`, with its two raw `mpi_gather` calls rewritten to the shared-memory gather. The serial `utilities_stub.f90` assumes one rank and reads past the end of per-rank arrays when `NPRO > 1`.

The runner reads `ranks` from `build.json`, sends cross-origin isolation headers, loads every rank before starting any, and times from the start message to the last rank's exit. Rank fields are concatenated in rank order, which reproduces the serial point order.

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --ranks 8 --output stats/exoplasim-wasm/shm-8
$env:EXOPLASIM_OUT = 'stats/exoplasim-wasm/shm-8'
node scripts/exoplasim-wasm/run-browser.mjs 480
```

Chrome 155, same machine (8 physical cores, 16 threads), ten model days, 30-minute steps, interleaved fresh Chrome processes:

| Build | Runs (seconds) | Speedup vs serial Wasm |
| --- | --- | --- |
| Serial Wasm | 20.94, 20.57, 20.96 | 1.00× |
| 4 ranks | 11.18, 11.17 | 1.87× |
| 8 ranks | 7.42, 7.48, 7.39 | 2.82× |

Eight ranks extrapolate to about 4.6 minutes per 360-day model year. Spin budgets of 0, 200,000 and 2,000,000 loads gave 7.2–7.8 s. Waking a sleeping worker is therefore not the limit; the remaining barrier time (1.4–2.6 s per rank) is ranks waiting on each other.

The native comparison must preprocess the sources. `carbonmod.f90` starts with `#define outputrain 0`, `keeprecord 0` and `precipweath 1`. Flang always preprocesses, so the Wasm build never writes the per-12-step rain files and uses the precipitation-based weathering formula. gfortran ignores these directives without `-cpp`: it compiles every conditional block, writes the rain files from rank 0, and the later `#else` branch overwrites the weathering result. With `-cpp` and the MPI `utilities.f90`, native OpenMPI takes 5.78–5.82 s at 8 ranks. Interleaved under the same, heavier machine load, the 16 MiB 8-rank browser build took 8.8–9.6 s, so the browser runs about 1.5–1.65× slower than native under load.

Against the serial Wasm build, the largest 8-rank differences are 1.3 × 10⁻¹² K in surface temperature after two steps and 7.3 × 10⁻¹² K after one model day. These come only from reduction order.

### Memory

The worker paints the unused stack before `main` and scans it afterwards; summaries record each rank's stack size, stack high-water mark, final Wasm memory, and `sbrk(0)` heap end. Over ten model days the serial build peaks at 8.68 MiB of stack (consistent with the native radiation routine exceeding an 8 MiB stack), with a heap end of 83.7 MiB. Each of 8 ranks peaks at 1.65 MiB of stack, and static data plus heap occupy about 3.5 MiB above the stack.

`--stack-mib` and `--initial-memory-mib` set the link-time stack and initial memory. Serial builds keep 64 and 128 MiB. Ranked builds default to an 8 MiB stack, about 5× the measured high water, and 16 MiB of initial memory. Memory growth stays enabled. At 8 ranks this cuts Wasm memory from 1 GiB to 128 MiB. One-day fields are identical to the 128 MiB-per-rank build, no rank grew its memory (heap end 11.5–12.3 MiB), and ten-day timing showed no measurable difference: interleaved runs took 7.75–8.77 s at 16 MiB and 7.93–8.77 s at 128 MiB under the same load. The Wasm payload is 2.0 MB at 8 ranks.

## Chaos Machine `/gcm` page

`/gcm` runs the shared-memory build on the repository's Earth heightmap and redraws the map as the model steps. Build the assets once (WSL toolchain from the setup above):

```powershell
pnpm build:gcm-wasm
```

`build_app.py` builds T21 and T42 (`--truncations`) for 2, 4 and 8 ranks into `public/gcm/tNN/ranks-N/`. Each resolution keeps one shared `tNN/exoplasim.data`, and the script fails if the rank variants' packages differ. It copies ExoPlaSim's `COPYING` and writes `public/gcm/manifest.json` listing each resolution's truncation, latitudes, precision, rank variants and download size at the largest rank count. Building one resolution keeps the other's manifest entry. `--link-only` relinks without recompiling. The page's Resolution setting picks one entry, and the browser fetches only that resolution's data and one Wasm variant: 4.6 MB for T21 or 12.7 MB for T42 at 8 ranks. The page uses the largest variant that fits half of `navigator.hardwareConcurrency`, since hyperthreads slowed native runs.

`--app` differs from the benchmark build in three ways: it emits an ES module for Vite module workers, it links `library_gcm.js`, and it appends `gcm_publish.f90` to `plasim.f90` with a call after each step. Every `publishEvery` steps (4, which is 3 model hours at 45 minutes) all ranks gather 18 surface fields in one `mpgagp` call and rank 0 posts them to the page. Rank 0 also checks a shared pause flag at every step; the other ranks block in the next barrier. Each step rank 0 also reads a shared stop flag and broadcasts it with `mpbci`, so every rank sets PlaSim's `nshutdown` on the same step. The fields are surface and 2 m temperature, lowest-level wind, wind at the level closest to σ = 0.25, total cloud cover, convective plus large-scale precipitation, surface pressure, column water vapour, sea-ice cover, snow depth, soil water, albedo, outgoing longwave at the top level, land fraction, net top-of-atmosphere radiation (`dswfl(:,1) + dlwfl(:,1)`, ExoPlaSim's `ntr`), and net surface heat flux (snow melt × −333700000 + surface net shortwave and longwave + sensible and latent heat, ExoPlaSim's `hfns`).

The page coalesces snapshots: the live store notifies React once per animation frame, or after at most 100 ms in a background tab. The page keeps monthly means and yearly balance records, without collecting a per-snapshot chart history. Rendering every snapshot (about 14 a second at T21) left a backlog that kept animating after the model had paused. With coalescing, the displayed date stopped within 100 ms of Pause. There is no Stop button; Pause halts the model and Restart starts a new run.

Model code lives in `src/model/climate/gcm/`:

- `grid`: Gaussian T21 latitudes and quadrature weights, used for area-weighted global means.
- `boundary`: area-weighted regridding of `public/earth-data/earth-real-elevation.bin.gz` onto the build's Gaussian grid, whose size comes from the manifest. It writes land fraction (`Nnnn_surf_0172.sra`, elevation above 0 m counts as land) and grid-box mean orography as geopotential (`Nnnn_surf_0129.sra`, g × mean of max(elevation, 0)). Rows run north to south, and longitudes start at 0° east, matching the shipped files.
- `namelist`: reproduces the namelist writes of ExoPlaSim's Python `Model.configure()` for the exposed parameters: flux, star temperature, year length, eccentricity, rotation period, obliquity, fixed orbit, N₂/O₂/Ar partial pressures (surface pressure and gas constant), ozone, wet soil, vegetation, initial growth, glaciers, physics filters and timestep. It also writes the companion defaults `configure()` sets with them. As in the wrapper, setting a star temperature forces wet soil off. The timestep defaults to the wrapper's 45 minutes. PlaSim's own automatic choice at T42 is 30 minutes, and 30 stays in the panel; multi-year stability at T42 and 45 minutes has not been checked. As in the wrapper, a rotation period other than one day overrides the year length with 360 / period days, rounded to a multiple of 12.
- `runner`: one module worker per rank, the shared exchange and pause buffers, and run lifecycle.
- `fields`: snapshot layout, display units and map modes.
- `balance`: ExoPlaSim's `_isbalanced` test on yearly global means of top-of-atmosphere and surface balance. It takes absolute 10-year running means, least-squares slopes over 5 consecutive running means, and the mean of the last 30 slopes, and both must be under 5 × 10⁻⁴ W/m² per year. It needs 14 model years before it can judge. The Run panel shows last month's two balances under Speed, then either the years still needed or the larger drift against the threshold.
- `checkpoint`: Save sets the stop flag. PlaSim leaves its main loop after the current step, and its epilog writes `plasim_status`, as ExoPlaSim's Python wrapper does between runs. Rank 0 returns that file, and the page downloads it as `exoplasim-tNN-yearYYYY-monthMM.ckpt`. Format 2 stores a magic line, a length-prefixed JSON header containing config, precision, date, step, and diagnostic metadata, a length-prefixed binary diagnostic-array block, then the unchanged restart file. Diagnostics preserve the latest snapshot, the last 12 monthly means, yearly balance records, and the unfinished month's sums and sample count. Load restores these records before initializing workers in a paused state. Annual maps, Köppen classes, and convergence retain their existing data immediately, and simulation steps wait for Resume. Saving also resumes the current session automatically, preserving its paused state. The loader rejects precision mismatches and older checkpoint formats, which omitted the diagnostic history and cannot reconstruct past annual results. File size now includes diagnostic arrays in addition to the model restart (previously about 7.3 MB at T21). Browser verification covered Save, Clear, and Load: loading restored the saved date and remained paused without date advancement. Focused regression checks cover diagnostic round-trip, immediate annual/Köppen availability, continued accumulation, and paused worker startup.
- `downscale`: the 0.5° display grid (the 2160 × 1080 heightmap averaged in 3 × 3 blocks). Fields are interpolated bilinearly from the Gaussian grid. Temperatures are also corrected to real elevation with a local lapse rate, after koppenpasta: the regression of temperature on elevation over each model cell and its 8 neighbours when they span at least 100 m, otherwise 6.5 K/km, clamped between 0 and 9.8 K/km. Köppen classes can be computed at 0.5° from 12 downscaled monthly means, with land where the 0.5° land fraction is at least 0.5. Drawing the downscaled view lowered T21 throughput by about 10% (1.01 against 1.12–1.18 model days per second) while another run shared the machine.
- `averages`: monthly means from every snapshot in each model month, keeping the last 12 completed months. They use the same packed layout as a live snapshot, so every map mode also works on averages. Wind modes show the mean vector wind. Annual means are the mean of those 12 months; PlaSim's months are equal-length. Köppen classes come from the repository's `KOPPEN.koppenCells` rules, applied to 12 monthly means of 2 m air temperature (°C) and precipitation (mm/day × 30). Cells with model land fraction ≥ 0.5 count as land. The page's Now / Monthly / Annual selector switches the map and global means between the latest snapshot, any of the last 12 months, and the 12-month mean. Köppen unlocks once 12 months have completed.

The Python wrapper deletes every shipped surface file when a land map is supplied. Doing the same here starts the ocean from defaults: the global mean surface temperature fell to −8 °C over the first 75 model days. The default instead keeps the shipped Earth surface files for the build's resolution (SST and sea-ice climatology, albedo, roughness, soil, vegetation, glaciers) and replaces only topography and land fraction. After 80 model days the global means were 12.6 °C surface temperature, 2.6 mm/day precipitation, 56% cloud cover and 224 W/m² outgoing longwave. The "Earth surface climatology" toggle switches back to the wrapper's behaviour. In Chrome on the development machine, 8 ranks ran at about 2 model days per second at T21 (roughly 3 minutes per 360-day year) and about 0.30 model days per second at T42 (roughly 20 minutes per year). A one-day T42 benchmark run took 7.1 s including startup, against 0.74 s per day for T21 at the same 30-minute step.

`build.py --truncation 42` uses ExoPlaSim's `T42` data (`N064_surf_*.sra`) and a separate `inputs-t42` directory. The default stack for ranked builds is three times a linear fit of points per rank. The fit comes from the T21 painted-stack measurements (8.68 MiB with 2048 points on one rank, 1.65 MiB with 256), and it underestimated T42: 6.49 MiB was measured with 1024 points per rank against 4.66 predicted. At T42 the variants get 51, 27 and 14 MiB of stack for 2, 4 and 8 ranks. When wasm-ld reports that static data needs more initial memory than requested, the build relinks with the reported size plus 1 MiB. At T42 that gives 93, 51 and 29 MiB per rank.

### Single precision

`build.py --precision 4` (and `build_app.py --precision 4`) compiles without `-fdefault-real-8 -fdefault-double-8`. This matches ExoPlaSim's own `compile.sh -p 4`, whose only difference is that flag; its `most_*_build4` scripts build standalone glacier utilities, not the model. The shared-memory layer, the utilities gathers and the snapshot hook take element sizes from the default real kind (`RBYTES = storage_size(0.0) / 8` in `mpimod_shm.f90`). Reductions sum 4-byte values in `Float32Array`s.

Checks, all at the default 30-minute step:

- Native serial gfortran with `-cpp`: T21 for 30 model days and T42 for 5 model days stayed finite, with field ranges close to double precision. gfortran signals underflow and denormal flags at exit.
- Wasm T42 with 2 ranks: 2 steps and one model day ran. Stack high water was 9.29 MiB per rank, and initial memory is 73 MiB per rank against 93 MiB in double precision. After one day, the mean absolute differences from the double-precision 8-rank run were 0.04 K surface temperature, 0.10 K air temperature, 0.09 m/s wind, 9 Pa surface pressure and 6.5 × 10⁻⁵ specific humidity. Global means matched.

Speed, T42 with 8 ranks, ten model days, interleaved runs in fresh Chrome processes:

| Build | Runs (seconds) | Median |
| --- | --- | --- |
| Double, before the fix below | 34.8, 35.0, 33.4 | 34.8 s |
| Single, before the fix below | 39.1, 37.5, 36.9 | 37.5 s |
| Double | 34.3, 32.6, 31.9 | 32.6 s |
| Single | 28.4, 27.5, 27.4 | 27.5 s |

At first, single precision was 7.5% slower. Sampled profiles over two model days showed the cause: math got cheaper (`pow` fell from 8.0% to 3.3% as `powf`, and `swr` plus `lwr` from 12.7% to 8.4%), but generic runtime assignment grew from 15.0% to 32.1%, because the bulk fill handled only 8-byte reals. The runtime patch in `runtime.py` now also fills contiguous 4-byte reals from a real scalar. Both branches now also require a real source, so a scalar from another type category takes the converting path. `runtime-check.f90` adds single-precision fills, strided and reversed sections, aliasing, signed zero, reallocation, and an integer(8) to real(8) fill. Both runtimes pass. Double-precision one-day output stayed bit-identical after relinking. With the fix, single precision takes 16% less time than double: about 17 minutes per 360-day year at T42 instead of 20.

ExoPlaSim's own guidance says precision 4 may be less stable, and that higher resolutions need higher precision. Multi-year T42 single-precision runs have not been checked, so the `/gcm` assets stay double precision.

### Radiation interval

`build.py` adds a radiation namelist setting, `NRADINT` (default 1), to `radmod.f90`. When it is above 1, `radstep` computes radiation only on steps where `mod(nstep, NRADINT) == 0`. It caches everything shortwave and longwave radiation write: fluxes, heating rates, flux convergence, surface albedos, and the clear-sky and entropy arrays. On the other steps it restores those arrays, adds the cached radiative heating to `dtdt`, and returns. The sun-angle and ozone routines only feed radiation and are skipped with it. The clear-sky cloud-forcing diagnostics (`ndiagcf`) and aerosol radiation are off in these runs and not cached. With `NRADINT = 1`, two-step T42 output is bit-identical to the unpatched build.

T42, single precision, 8 ranks, 45-minute steps:

| `NRADINT` | Radiation every | Ten model days | One-day mean abs. difference from `NRADINT = 1` |
| --- | --- | --- | --- |
| 1 | 45 min | 19.0, 19.1 s | — |
| 2 | 1.5 h | 17.6, 17.9 s | 0.16 K surface, 0.18 K 2 m, 0.08 m/s wind, 5 Pa |
| 3 | 2.25 h | 17.2, 17.1 s | 0.25 K surface, 0.30 K 2 m, 0.13 m/s wind, 8 Pa |

Global mean 2 m temperature after one day differed by 0.02 K at 2 and 0.06 K at 3. The saving is smaller than older profiles suggested, because single precision and the 4-byte fill already cut radiation's share. `/gcm` keeps radiation every step by default and offers every 2 or 3 steps in its panel. The 45-minute step itself took 19.0 s per ten model days against 27.5 s at 30 minutes, about 11 minutes per T42 year.

## Port adjustments

- `build.py` copies upstream sources into an isolated build directory, selects existing serial/GUI/ocean-coupling stubs, and adds the missing `aerocore.o` dependency on `aeromod.o`.
- Calendar initialization calls are supplied their missing timestep argument as integer minutes, matching the existing calendar routine's argument type. Unused serial and ocean stub signatures are aligned with their callers. These source adjustments also apply to the native reference.
- The hurricane initializer imports `mypid`, `NROOT`, and `nwritehurricane` from `pumamod`. Without those imports they are uninitialized locals, which LLVM optimizes into a Wasm trap. The exact Fortran changes are saved as `stats/exoplasim-wasm/model-source.patch`.
- A small C entry point initializes the Flang runtime and invokes the Fortran main program. A diagnostic subroutine writes surface and surface-air temperature, lowest-layer winds, surface pressure, and lowest-layer humidity before normal shutdown.
- `compile.py` emits LLVM IR with Flang and repairs four runtime interface declarations/calls before LLVM optimization and Wasm code generation: logical file inquiries, 64-bit integer output, system clock counts, and array counts. Full 64-bit output operands are recovered before the compiler's truncation; the build fails if it cannot recover them. See the [upstream runtime ABI bug](https://github.com/r-wasm/flang-wasm/issues/12).
- `runtime.py` builds the matching LLVM 19.1.7 runtime with 64-bit array-descriptor element lengths and indices, matching the compiler's generated descriptor layout. The prebuilt runtime's 32-bit layout aborts during the first namelist read. Decimal conversion sources are compiled and linked explicitly. Wasm does not provide native IEEE floating-point exception flags; exception identifiers used by the runtime are supplied for compilation, without providing hardware exception trapping.
- The default runtime adds the guarded scalar bulk fill described above. Exact C++ and descriptor-header changes are saved as `stats/exoplasim-wasm/runtime-source.patch`.
- The model receives a 64 MiB stack because the native radiation routine exhausts Ubuntu's default 8 MiB stack. The browser starts with 128 MiB of Wasm linear memory, including that stack, and can grow if needed. Stack overflow checks remain enabled.

This is a feasibility experiment. Passing the smoke check does not establish equilibrium climate accuracy, long-run numerical stability, restart portability, output-format support, or performance across browsers and devices. Output accumulation and snapshots are disabled for the initial throughput measurement. Python orchestration and postprocessing are not included.

Sources: [ExoPlaSim](https://github.com/alphaparrot/ExoPlaSim/tree/5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff), [Flang Wasm toolchain background](https://blog.jupyter.org/posts/2025/r-in-the-browser-announcing-our-webassembly/), [LLVM 19.1.7 decimal sources](https://github.com/llvm/llvm-project/tree/llvmorg-19.1.7/flang/lib/Decimal).

### Map interaction and settings

The equirectangular map uses the same orthographic camera and OrbitControls as the planet flat map: cursor-centered wheel zoom, drag pan, touch pan/pinch, horizontal world wrapping, and explicit zoom/reset buttons. Latitude stays within the poles. The map fits the remaining viewport height instead of imposing a width-based 2:1 element height. The camera adapts its geographic framing without stretching the map, and the sidebar scrolls independently. The map redraws at viewport size and device pixel ratio; zoom uses sharp native climate cells while coastlines and wind arrows redraw at the current scale. Zoom cannot add detail beyond the model or downscaled grid. Repeated raster copies share integer device-pixel edges to avoid hairline seams. The shared planet coastline filter removes artificial polygon-closing segments at the dateline, while genuine coastline crossings continue through it.

Map modes are grouped into Temperature (Surface/Air), Wind (Surface/Jet stream), Moisture (Water vapor/Soil water), Ice & snow (Sea ice/Snow), and Radiation (Albedo/Outgoing IR); Clouds, Rain, Pressure, and Köppen remain leaf modes. Selecting a parent selects its first child. Child controls appear beside Model grid/Downscaled, behind a separator shown only for parents with children.

A compact hover readout sits directly beneath the year/date outside the header layout flow, so activating hover does not change header height or map position. Its first row shows latitude and longitude in the main planet map's shared format (one decimal and °N/°S/°E/°W); each active map statistic or Köppen class has its own row beneath. Values match the selected live, monthly, or annual snapshot and metric/imperial units. It samples the same field data as the renderer.

The sidebar uses the main planet view's icon controls: a close icon inside the open panel and a tooltip-backed Details icon over the map only while closed. Hiding it expands the map without restarting the simulation. Settings are grouped into Numerics, Star, Orbit & rotation, Atmosphere, and Surface & vegetation, in that order. Settings apply when a run starts and are disabled while it is active. Run actions are Start/Pause/Resume, Save, Load, then Clear. Clear stops workers, discards results and pending startup work, and unlocks settings without starting again; it retains the current planet settings for editing.

### Asset loading

Opening `/gcm` fetches the resolution manifest but does not initialize the model. Start and Load create fresh workers for the selected resolution and worker-count variant. Each worker imports its generated JavaScript module, fetches its Wasm module and the resolution's shared data package, and initializes its own Wasm instance. Load initializes paused and waits for Resume before stepping. Only the selected variant is requested. Ordinary browser HTTP caching can reuse unchanged assets; there is no application-managed persistent artifact cache, and a new run still initializes fresh workers and model memory.