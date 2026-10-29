# ExoPlaSim WebAssembly experiment

For local GPU hardware checks and native Fortran acceleration options, see [CUDA feasibility research](exoplasim-cuda.md).

For the matched T21 climate comparison between the pinned source and the published 3.2.4 release, see [Native version comparisons](exoplasim-native-versions.md).

For the current browser controls, atmospheric-layer maps, snapshot layout and checkpoint format, see [Browser model controls and diagnostics](exoplasim-controls.md). The measurements below retain their historical configurations.

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
- Applying Flang frontend `-O3` reduced generic assignment call sites in the main module from 360 to 61, but produced NaNs in the browser check. The cause is aliasing in `fftmod.f90`; see [Frontend optimization](#frontend-optimization), which now enables `-O2` for every other file.
- Emscripten host JavaScript math took 21.162 seconds with bulk filling and diverged from the reference trajectory after ten days (maximum surface-temperature difference 11.24 K). It failed the comparison and is not enabled.

The failed frontend/host-math modes are not exposed by the final build script. SIMD remains available as `--variant simd` for future hardware/compiler experiments; the default is `--variant scalar`. `--assignment generic` selects the original runtime for comparison. `--profile` retains function names for CPU sampling without changing the optimization level.

Preserved original artifacts are under `stats/exoplasim-wasm/baseline/`. The repeated-run comparison is `stats/exoplasim-wasm/optimization-comparison.json`; exact reports are listed there. Candidate output and profiles remain under `simd/`, `optimized/`, `host-math/`, and `bulk/`. Stats stay local and ignored by Git.

The browser runner accepts `EXOPLASIM_OUT`, `EXOPLASIM_REFERENCE`, and an alphanumeric `EXOPLASIM_RUN` label, saving separate reports instead of overwriting earlier runs. `EXOPLASIM_PROFILE=1` records a Chrome CPU trace and sampled hotspot summary; omit it for timing. For example, after building into `stats/exoplasim-wasm`:

```powershell
$env:EXOPLASIM_REFERENCE = 'stats/exoplasim-wasm/baseline'
$env:EXOPLASIM_RUN = 'verification'
node scripts/exoplasim-wasm/run-browser.mjs 480
```

### Frontend optimization

`compile.py` used to emit LLVM IR with Flang at `-O0` and optimize only in clang, so whole-array assignments stayed as calls into the Flang runtime. Flang now emits IR at `-O2` (`build.py --frontend-opt 2`, the default; `0` restores the old build for comparisons). Files in `FRONTEND_O0_FILES` in `build.py` stay at `-O0`. `build.json` records the level and the list.

The list holds one file, `fftmod.f90`. With every file at `-O2`, two steps already differed from the `-O0` build by up to 97 K, and one model day produced NaNs. Frontend level changes neither symbols nor module interfaces, so the culprit was found by linking mixes of `-O0` and `-O2` objects and running two steps: 12 links, one failing file. `gp2fc` and `fc2gp` call `dfft8(a,a,n,lot)` and `ifft8(a,a,n,lot)`, passing one array as both the input and the output dummy. Fortran forbids that when a dummy is modified, and at `-O2` Flang assumes the two do not overlap. None of the runtime calls `compile.py` repairs occur in `fftmod`, so the ABI repair is not involved.

Binaryen 123 segfaults while writing StackIR for the `-O2` module: every pass and validation succeeds, then the binary writer crashes and leaves an empty `exoplasim.wasm`. Every Wasm link now passes `-sBINARYEN_EXTRA_PASSES=--no-stack-ir`. On the `-O0` build that flag leaves two-step and ten-day output bit-identical and changes Wasm size by 3 bytes.

`_FortranAAssign` call sites across all emitted IR fell from 1,707 to 112 (360 to 61 in `plasim.f90`, 267 to 27 in `radmod.f90`). The 8-rank T21 Wasm shrank from 2,003,037 to 1,809,755 bytes.

Checks against the `-O0` 8-rank T21 build, double precision, 30-minute steps:

| Check | Result |
| --- | --- |
| Two steps, largest difference | 2.2 × 10⁻¹² K surface temperature, 2.9 × 10⁻¹¹ Pa |
| One model day, largest difference | 8.9 × 10⁻¹² K surface temperature, 8.7 × 10⁻¹¹ Pa |
| Serial `-O2` against native after one day | 1.2 × 10⁻¹¹ K, 1.0 × 10⁻¹⁰ Pa |
| Ten days, global means | 285.7139 → 285.7126 K surface, 97565.09 Pa unchanged |
| Ten days, RMS / largest difference | 0.23 K / 10.5 K surface temperature |

After ten days the trajectories have separated, as they do for any last-bit change. The same `-O0` code at 4 ranks, which differs from 8 ranks only in reduction order, ends ten days 0.27 K RMS and 12.7 K at most from the 8-rank run, slightly further than `-O2` does.

Eight interleaved rounds of ten model days (480 steps) in fresh Chrome processes, 8 ranks, T21:

| Build | Runs (seconds) | Median |
| --- | --- | --- |
| `-O0` | 8.43, 8.72, 8.59, 7.74, 7.55, 7.37, 7.50, 7.51 | 7.65 s |
| `-O0`, no StackIR | 7.77, 9.01, 7.94, 7.39, 7.44, 7.21, 7.65, 7.46 | 7.55 s |
| `-O2` | 7.10, 7.01, 7.86, 6.63, 6.69, 6.63, 7.52, 6.61 | 6.85 s |

The first three rounds ran under heavier machine load. `-O2` was faster than `-O0` in 7 of 8 rounds; in the seventh it was 0.02 s slower. Its median is 10.5% lower over all rounds, and 11.7% lower over the quieter rounds 4–8 (6.63 against 7.51 s). Its slowest run (7.86 s, round 3) is slower than the fastest `-O0` run (7.37 s, round 6), so the noisy rounds overlap. Skipping StackIR made no difference beyond noise. Extrapolated, 8 ranks take about 4.1 minutes per 360-day T21 year at 30-minute steps.

Mean barrier share per rank (`barrierMs / rankSimulationMs`) rose from 18.6% to 20.4%. Compute per rank shrank while the time ranks wait on each other did not.

Sampled self time over 96 steps, 8 ranks, builds relinked with `--profile`:

| Function | `-O0` | `-O2` |
| --- | --- | --- |
| Runtime `Assign` | 9.3% | 1.0% |
| `gridpointd` | 34.1% | 46.8% |
| `_QQmain` | 14.6% | 16.1% |
| `pow` | 7.2% | 6.5% |
| `swr` + `lwr` | 11.3% | 9.2% |

On the `/gcm` page (T21, Earth defaults, 8 workers, headless Chrome against the dev server), three alternating rounds of old and new assets each sampled the Speed readout 12 times after 10 s of warm-up. The pooled median rose from 1.43 to 1.71 model days per second (means 1.40 and 1.66). Samples ranged from 0.7 to 2.3 while other work shared the machine, and the old assets read faster in the first round, so this confirms the direction, not the size. The in-app browser pane is not suitable for this measurement: when the window was not in front, the page dropped from about 8.6 to 3.8 busy cores.

`gridpointd` grows because inlined callees are now attributed to it. Total samples are not comparable between profiles: two profiling pairs disagreed on which build took more samples, so the timing table is the speed measurement. T42 has not been measured with `-O2` yet.

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

Custom PNG heightmaps, Chaos Machine binary terrain and independent land masks are supported by the [terrain importer](custom-terrain.md). Checkpoint format 3 embeds the terrain. Boundary generation and display downscaling share spherical-area overlap sampling, so coarse inputs remain finite and masks retain land at zero or negative elevation.

On 2026-10-25, the importer was verified against Chaos Machine seed 14963991 (204,001 regions), exported at 1440 × 720 from `stats/routes/2026-10-10T20-35-25-488Z-bidirectional-production/world.bin` in the Chaos Machine checkout. Elevations ranged from −7,887 to 6,000 m; area-weighted land coverage was 31.5735%. There were 5,342 pixels whose explicit mask differed from elevation sign. The binary import preserved all samples exactly. Maximum PNG round-trip errors over a −12,000 to 20,000 m encoding range were 0.24463 m at 16 bits and 62.7461 m at 8 bits. Chrome passed source/model previews, GCM startup, pause/save and paused checkpoint restoration with no page errors; reports are under `stats/terrain-import/`. These are functional and precision checks, not throughput measurements.

`/gcm` runs the shared-memory build on the repository's Earth heightmap and redraws the map as the model steps. Build the assets once (WSL toolchain from the setup above):

```powershell
pnpm build:gcm-wasm
```

`build_app.py` builds T21 and T42 (`--truncations`) for 2, 4 and 8 ranks into `public/gcm/tNN/ranks-N/`. Each resolution keeps one shared `tNN/exoplasim.data`, and the script fails if the rank variants' packages differ. It copies ExoPlaSim's `COPYING` and writes `public/gcm/manifest.json` listing each resolution's truncation, latitudes, precision, rank variants and download size at the largest rank count. Building one resolution keeps the other's manifest entry. `--link-only` relinks without recompiling. The page's Resolution setting picks one entry, and the browser fetches only that resolution's data and one Wasm variant: 4.6 MB for T21 or 12.7 MB for T42 at 8 ranks. The page uses the largest variant that fits half of `navigator.hardwareConcurrency`, since hyperthreads slowed native runs.

`--app` differs from the benchmark build in three ways: it emits an ES module for Vite module workers, it links `library_gcm.js`, and it appends `gcm_publish.f90` to `plasim.f90` with a call after each step. Every `publishEvery` steps (4, which is 3 model hours at 45 minutes) all ranks gather 18 surface fields in one `mpgagp` call and rank 0 posts them to the page. Rank 0 also checks a shared pause flag at every step; the other ranks block in the next barrier. Each step rank 0 also reads a shared stop flag and broadcasts it with `mpbci`, so every rank sets PlaSim's `nshutdown` on the same step. The fields are surface and 2 m temperature, lowest-level wind, wind at the level closest to σ = 0.25, total cloud cover, convective plus large-scale precipitation, surface pressure, column water vapour, sea-ice cover, snow depth, soil water, albedo, outgoing longwave at the top level, land fraction, net top-of-atmosphere radiation (`dswfl(:,1) + dlwfl(:,1)`, ExoPlaSim's `ntr`), and net surface heat flux (snow melt × −333700000 + surface net shortwave and longwave + sensible and latent heat, ExoPlaSim's `hfns`).

The page coalesces snapshots: the live store notifies React once per animation frame, or after at most 100 ms in a background tab. The page keeps monthly means and yearly balance records, without collecting a per-snapshot chart history. Rendering every snapshot (about 14 a second at T21) left a backlog that kept animating after the model had paused. With coalescing, the displayed date stopped within 100 ms of Pause. There is no Stop button; Pause halts the model and Restart starts a new run.

Model code lives in `src/model/climate/gcm/`:

- `grid`: Gaussian T21 latitudes and quadrature weights, used for area-weighted global means.
- `boundary`: spherical-area overlap regridding of the selected terrain onto the build's Gaussian grid, whose size comes from the manifest. Earth defaults to `public/earth-data/earth-real-elevation.bin.gz`, with land derived from positive elevation. Custom terrain can supply an independent mask. It writes land fraction (`Nnnn_surf_0172.sra`) and grid-box mean orography as geopotential (`Nnnn_surf_0129.sra`, g × area mean of elevation multiplied by land coverage). Rows run north to south, and longitudes start at 0° east, matching the shipped files.
- `namelist`: reproduces the namelist writes of ExoPlaSim's Python `Model.configure()` for the exposed parameters: flux, star temperature, year length, eccentricity, rotation period, obliquity, fixed orbit, N₂/O₂/Ar partial pressures (surface pressure and gas constant), ozone, wet soil, vegetation, initial growth, glaciers, physics filters and timestep. It also writes the companion defaults `configure()` sets with them. As in the wrapper, setting a star temperature forces wet soil off. The timestep defaults to the wrapper's 45 minutes. PlaSim's own automatic choice at T42 is 30 minutes, and 30 stays in the panel; multi-year stability at T42 and 45 minutes has not been checked. As in the wrapper, a rotation period other than one day overrides the year length with 360 / period days, rounded to a multiple of 12.
- `runner`: one module worker per rank, the shared exchange and pause buffers, and run lifecycle.
- `fields`: snapshot layout, display units and map modes.
- `balance`: ExoPlaSim's `_isbalanced` test on yearly global means of top-of-atmosphere and surface balance. It takes absolute 10-year running means, least-squares slopes over 5 consecutive running means, and the mean of the last 30 slopes, and both must be under 5 × 10⁻⁴ W/m² per year. It needs 14 model years before it can judge. The Run panel shows last month's two balances under Speed, then either the years still needed or the larger drift against the threshold.
- `checkpoint`: Save sets the stop flag. PlaSim leaves its main loop after the current step, and its epilog writes `plasim_status`, as ExoPlaSim's Python wrapper does between runs. Rank 0 returns that file, and the page downloads it as `exoplasim-tNN-yearYYYY-monthMM.ckpt`. Format 2 stores a magic line, a length-prefixed JSON header containing config, precision, date, step, and diagnostic metadata, a length-prefixed binary diagnostic-array block, then the unchanged restart file. Diagnostics preserve the latest snapshot, the last 12 monthly means, yearly balance records, and the unfinished month's sums and sample count. Load restores these records before initializing workers in a paused state. Annual maps, Köppen classes, and convergence retain their existing data immediately, and simulation steps wait for Resume. Saving also resumes the current session automatically, preserving its paused state. The loader rejects precision mismatches and older checkpoint formats, which omitted the diagnostic history and cannot reconstruct past annual results. File size now includes diagnostic arrays in addition to the model restart (previously about 7.3 MB at T21). Browser verification covered Save, Clear, and Load: loading restored the saved date and remained paused without date advancement. Focused regression checks cover diagnostic round-trip, immediate annual/Köppen availability, continued accumulation, and paused worker startup.
- `downscale`: a display grid capped at 720 × 360, using the same spherical-area overlap sampler as boundary generation. Earth produces a 0.5° grid; smaller inputs retain their resolution. Fields are interpolated bilinearly from the Gaussian grid. Temperatures are also corrected to real elevation with a local lapse rate, after koppenpasta: the regression of temperature on elevation over each model cell and its 8 neighbours when they span at least 100 m, otherwise 6.5 K/km, clamped between 0 and 9.8 K/km. Köppen classes can be computed at 0.5° from 12 downscaled monthly means, with land where the 0.5° land fraction is at least 0.5. Drawing the downscaled view lowered T21 throughput by about 10% (1.01 against 1.12–1.18 model days per second) while another run shared the machine.
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
- `glaciermod.f90` promotes persistent snow to glacier at each calendar year's end instead of at session shutdown, and saves `persistflag` in the restart. One long browser session then behaves like the Python wrapper's one-year sessions, and Save no longer changes glacier cover. See [Glacier lifecycle](exoplasim-glaciers.md).
- A small C entry point initializes the Flang runtime and invokes the Fortran main program. A diagnostic subroutine writes surface and surface-air temperature, lowest-layer winds, surface pressure, and lowest-layer humidity before normal shutdown.
- `compile.py` emits LLVM IR with Flang and repairs four runtime interface declarations/calls before LLVM optimization and Wasm code generation: logical file inquiries, 64-bit integer output, system clock counts, and array counts. Full 64-bit output operands are recovered before the compiler's truncation; the build fails if it cannot recover them. See the [upstream runtime ABI bug](https://github.com/r-wasm/flang-wasm/issues/12).
- `runtime.py` builds the matching LLVM 19.1.7 runtime with 64-bit array-descriptor element lengths and indices, matching the compiler's generated descriptor layout. The prebuilt runtime's 32-bit layout aborts during the first namelist read. Decimal conversion sources are compiled and linked explicitly. Wasm does not provide native IEEE floating-point exception flags; exception identifiers used by the runtime are supplied for compilation, without providing hardware exception trapping.
- The default runtime adds the guarded scalar bulk fill described above. Exact C++ and descriptor-header changes are saved as `stats/exoplasim-wasm/runtime-source.patch`.
- The model receives a 64 MiB stack because the native radiation routine exhausts Ubuntu's default 8 MiB stack. The browser starts with 128 MiB of Wasm linear memory, including that stack, and can grow if needed. Stack overflow checks remain enabled.

This is a feasibility experiment. Passing the smoke check does not establish equilibrium climate accuracy, long-run numerical stability, restart portability, output-format support, or performance across browsers and devices. Output accumulation and snapshots are disabled for the initial throughput measurement. Python orchestration and postprocessing are not included.

Sources: [ExoPlaSim](https://github.com/alphaparrot/ExoPlaSim/tree/5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff), [Flang Wasm toolchain background](https://blog.jupyter.org/posts/2025/r-in-the-browser-announcing-our-webassembly/), [LLVM 19.1.7 decimal sources](https://github.com/llvm/llvm-project/tree/llvmorg-19.1.7/flang/lib/Decimal).

### Map interaction and settings

The map and hover readout receive a memoized layer reader instead of raster arrays in React props. React 19's development profiler recursively expands changed props into performance entries, including removed props, so passing terrain directly caused stalls both entering and leaving elevation mode. The reader changes with the selected layer and returns the same data for rendering and hover sampling without exposing the arrays to prop profiling.

On 2026-10-25, Chrome at `http://localhost:5173/gcm`, development build, no CPU/network throttling: four idle Elevation/Temperature transitions took 1,390/1,246/1,147/1,175 ms before this change and 73/62/67/67 ms after a fresh reload. Measurements run from a button click through two animation frames, including render and paint opportunity. Instrumenting `performance.measure` before the fix attributed 279–364 ms per component to the map and hover readout; it excludes React's work building the measurement details. With real T21 output paused, model-grid transitions took 69–134 ms and downscaled transitions 84–183 ms. While eight model workers were running, transitions took 200–448 ms. These are small local interaction samples, not model-throughput benchmarks; worker CPU contention and browser scheduling affect the results. The test run was cleared afterward.

Elevation data and its cached color raster use the full source resolution: 2160 × 1080 for bundled Earth. Hover sampling and the elevation legend use the complete terrain. Earth conversion is shared between the display and model startup. After restoring full resolution on 2026-10-25, the same idle transition check measured 85/42/69/86 ms for Elevation/Temperature/Elevation/Temperature, and canvas instrumentation confirmed 2160 × 1080 image uploads. The 720 × 360 cap remains specific to climate downscaling.

Elevation mode draws the same coastline overlay as climate modes. Land colors use Chaos Machine's colored elevation ramp (`src/ui/genesis/shared/colors/elevation.ts`, `landColorStops`): 19 linearly interpolated stops from pale green through tan and brown to off-white, normalized between zero and the terrain maximum. The ocean retains its existing solid blue. The map, legend and import previews share the color function; the terrain mask determines land, including land at or below sea level, and model-grid previews blend fractional land coverage. With the coastline and shared ramp enabled, three idle Elevation/Temperature/Elevation transitions on 2026-10-25 measured 320/193/236 ms in the same development browser; full-resolution color sampling and coastline drawing add work compared with the previous two-color terrain without coastlines.

The equirectangular map uses the same orthographic camera and OrbitControls as the planet flat map: cursor-centered wheel zoom, drag pan, touch pan/pinch, horizontal world wrapping, and explicit zoom/reset buttons. Latitude stays within the poles. The map fits the remaining viewport height instead of imposing a width-based 2:1 element height. The camera adapts its geographic framing without stretching the map, and the sidebar scrolls independently. The map redraws at viewport size and device pixel ratio; zoom uses sharp native climate cells while coastlines and wind arrows redraw at the current scale. Zoom cannot add detail beyond the model or downscaled grid. Repeated raster copies share integer device-pixel edges to avoid hairline seams. The shared planet coastline filter removes artificial polygon-closing segments at the dateline, while genuine coastline crossings continue through it.

Map modes are grouped into Temperature (Surface/Air), Wind (Surface/Jet stream), Moisture (Water vapor/Soil water), Ice & snow (Sea ice/Snow), and Radiation (Albedo/Outgoing IR); Clouds, Rain, Pressure, and Köppen remain leaf modes. Selecting a parent selects its first child. Child controls appear beside Model grid/Downscaled, behind a separator shown only for parents with children.

A compact hover readout sits directly beneath the year/date outside the header layout flow, so activating hover does not change header height or map position. Its first row shows latitude and longitude in the main planet map's shared format (one decimal and °N/°S/°E/°W); each active map statistic or Köppen class has its own row beneath. Values match the selected live, monthly, or annual snapshot and metric/imperial units. It samples the same field data as the renderer.

The sidebar uses the main planet view's icon controls: a close icon inside the open panel and a tooltip-backed Details icon over the map only while closed. Hiding it expands the map without restarting the simulation. Settings are grouped into Numerics, Star, Orbit & rotation, Atmosphere, and Surface & vegetation, in that order. Settings apply when a run starts and are disabled while it is active. Run actions are Start/Pause/Resume, Save, Load, then Clear. Clear stops workers, discards results and pending startup work, and unlocks settings without starting again; it retains the current planet settings for editing.

### Asset loading

Opening `/gcm` fetches the resolution manifest but does not initialize the model. Start and Load create fresh workers for the selected resolution and worker-count variant. Each worker imports its generated JavaScript module, fetches its Wasm module and the resolution's shared data package, and initializes its own Wasm instance. Load initializes paused and waits for Resume before stepping. Only the selected variant is requested. Ordinary browser HTTP caching can reuse unchanged assets; there is no application-managed persistent artifact cache, and a new run still initializes fresh workers and model memory.

### Expanded diagnostics and controls verification

On 2026-10-25, all six app variants were rebuilt without `--link-only` for the 62-field snapshot hook. The rebuild uses the current documented frontend setting, `-O2` except `fftmod.f90` at `-O0`; the previously checked-in T42 artifacts still recorded frontend `-O0`. The snapshot now includes evaporation, runoff, forest cover, leaf area, and temperature/wind/relative humidity on all ten atmospheric layers. Existing TOA and surface energy fields also have map views. See [Browser model controls and diagnostics](exoplasim-controls.md) for definitions, settings, display ranges and checkpoint format 4.

`node scripts/exoplasim-wasm/verify-model-options.mjs` against the development server at `http://localhost:5174`, headless installed Chrome, double precision, 30-minute steps, radiation every step, at least 48 elapsed steps per case:

| Resolution | Ranks | Vegetation | Startup + one-day run + checkpoint shutdown |
| --- | --- | --- | --- |
| T21 | 2 | Off | 3.13 s |
| T21 | 4 | Diagnostic | 2.73 s |
| T21 | 8 | Coupled | 3.29 s |
| T42 | 2 | Off | 12.82 s |
| T42 | 4 | Diagnostic | 9.43 s |
| T42 | 8 | Coupled | 8.24 s |

Cases ran sequentially with no other model page running. Configuration was 1,000 ppm CO₂, 1.2 Earth radii, 12 m/s² gravity, fixed illumination at 90° east, 20 m mixed-layer depth and a coarse test continent. These are single functional-check timings, not repeated throughput benchmarks; settings vary by row and initialization/checkpoint costs are included. They do not support a speed comparison with historical `run-browser.mjs` timings. Checkpoints were about 9.1–9.3 MB at T21 and 36.5–37.3 MB at T42 for this tiny terrain and short history. Larger terrain and completed monthly history increase those sizes.

All 62 fields were finite in every published snapshot; every variant loaded its checkpoint paused without publishing additional snapshots. Core checks covered both grid sizes, CO₂'s pressure and molecular-weight contribution, radius/gravity/illumination/ocean namelists, gravity-aware terrain, all 50 map definitions and palettes, units, monthly/annual history and checkpoint round trips. The UI check exercised the new maps, layer selection, downscaling, illumination controls, and Save → Clear → Load; the loaded run remained paused. Rendered atmospheric and energy maps were visually inspected. `pnpm lint` and `pnpm typecheck` passed. Report and screenshots: `stats/exoplasim-model-options/report-21-42.json`, `layers.png`, and `energy.png` (gitignored). This checks short-run operation, not equilibrium or long-term stability.

### Ice and snow diagnostics

On 2026-10-25 the browser snapshot expanded from 62 to 66 fields, adding the existing Fortran `dprs`, `dsmelt`, `diced` and `dglac` diagnostics. Ice & snow now includes snowfall, snowmelt, physical sea-ice thickness and glacier cover. The model's physics and configuration are unchanged by these additions; checkpoint format 5 identifies the expanded array layout. Definitions and display ranges are in [Browser model controls and diagnostics](exoplasim-controls.md).

A paired T21/8-rank check ran the saved 62-field binary and rebuilt 66-field binary sequentially with identical packaged boundary data, default browser configuration except a 30-minute timestep, double precision, and 48 model steps. All 126,976 values in the previously published fields matched exactly, including the atmospheric layers whose slots moved by four fields. Maximum absolute difference was zero. The saved binary is under `stats/exoplasim-model-options/before-ice/`, with the comparison script and result in `compare-ice-hook.mjs` and `ice-additive-comparison.json`. This is a short numerical check of the additive extraction, not a climate-equilibrium experiment.

The expanded verifier checks all 54 map definitions, water-equivalent rate conversions, physical ice-depth conversion to metric/imperial units, glacier percentages, monthly/annual retention, checkpoint round trips and rejection of obsolete layouts. Its UI check selects the four new views, exercises interpolated display, saves/clears/loads the paused session and captures `ice.png`. T21's 2/4/8-rank one-day checks passed with all 66 diagnostics finite and paused reloads. In those short coarse-continent cases, maximum snowfall was 3.30–5.51 mm/day water equivalent, snowmelt 22.25–37.35 mm/day water equivalent, sea-ice thickness 2.67 m and glacier cover 100%. These are startup diagnostic ranges, not climatological statistics. T21 report: `stats/exoplasim-model-options/report-66-21.json`. Timing in that report overlapped T42 compilation and should not be used for performance comparisons.

T42's 2/4/8-rank one-day checks also passed, along with the same UI save/load checks; report: `stats/exoplasim-model-options/report-66-42.json`. The three startup/run/checkpoint intervals were 8.43/5.70/5.27 s respectively, with the same configuration described above and no simultaneous model run. These single functional-check timings do not establish a performance change. All six assets were rebuilt without `--link-only`. The final T42/8-rank build hit a Windows/WSL output-file write error; rebuilding into the ignored staging directory succeeded. Its JS/Wasm/build metadata were copied into the served variant after confirming that the staged data package matched the shared T42 package, and the manifest sizes were recomputed. Interrupted-build leftovers were removed. `pnpm lint` and `pnpm typecheck` passed.

### Upstream pressure and cloud outputs

On 2026-10-25, the snapshot expanded to 77 fields: the previous 66 plus sea-level pressure and cloud cover on each of the ten model layers. Layer clouds are the existing `dcc(:,jlevel)` output (code 162); total cover remains `dcc(:,NLEP)`. Sea-level pressure ports the existing `pyburn.py` `slpcode` reduction, using the model's surface geopotential and atmospheric constants. No new wind diagnostic is included: the pinned source names 10 m components in its catalogue but does not implement those outputs. The unsupported wind extrapolation was removed from source, UI, checks and the delivered binaries. The abandoned staging build containing it was discarded.

`verify-weather.py` compiles the actual hook against controlled fixtures. Zero elevation preserves surface pressure exactly; positive/negative elevations change the reduced pressure in the expected directions. The largest pressure difference from an independent exact hydrostatic lapse-rate integral was 0.05383 Pa (upstream uses a polynomial approximation). All ten cloud slots matched the prescribed fixture fractions. Details and tolerances are in [Browser model controls and diagnostics](exoplasim-controls.md).

Two otherwise identical 48-step T21/8-rank runs compared the saved 66-field binary with the final 77-field binary. All 135,168 previously published values matched exactly; maximum absolute difference was zero. This checks the published fields at a short endpoint, not every internal variable or equilibrium accuracy. The source binary, script and report are under `stats/exoplasim-model-options/before-weather/`, `compare-weather-hook.mjs` and `weather-additive-comparison.json`.

All six variants were rebuilt without `--link-only` into `stats/exoplasim-model-options/weather-supported-build/`, then copied into `public/gcm/` after checking their shared input packages. `verify-model-options.mjs 21` and `verify-model-options.mjs 42` passed all 65 map definitions, conversions, monthly/annual retention, checkpoint-format-6 round trips, obsolete-format rejection, one-day model runs and paused reloads at 2/4/8 ranks. UI checks selected surface/sea-level pressure and individual cloud layers, exercised interpolated display, and saved/cleared/loaded the session. Pressure and cloud-layer screenshots were visually inspected. Reports are `report-77-21.json` and `report-77-42.json` under `stats/exoplasim-model-options/`; the native fixture report is `weather-formulas.json`. `pnpm lint` and `pnpm typecheck` passed.

T42 startup/run/checkpoint intervals were 9.19/6.47/5.87 s for 2/4/8 ranks with the same short functional-check configuration as the ice additions and no overlapping model run. These are single functional checks, not performance comparisons. T21 cases ran during compilation, so their elapsed times should not be used for throughput comparisons. A packed T42 UI snapshot now carries 2,523,136 bytes (77 × 8,192 × 4), up from 2,162,688 bytes at 66 fields. No annual integration was needed to verify these output additions; annual retention was checked with synthetic monthly data.


### Native albedo overrides and surface energy components

On 2026-10-25, three optional albedo overrides were added for land, ocean and snow/ice, following the pinned Python `Model.configure()` implementation. All default to `None`/`null`: the browser writes no albedo namelist entries and retains native spectral, surface-map and temperature-dependent settings. The UI displays “ExoPlaSim default” until an override is enabled. Definitions, override mapping and source-based starting values are in [Browser model controls and diagnostics](exoplasim-controls.md#albedo-defaults-and-overrides).

The snapshot expanded from 77 to 81 scalar fields, exposing the model's existing net surface shortwave, net surface longwave, sensible and latent heat fluxes. Surface energy groups these four maps with net surface heat. All fluxes retain the model's positive-into-surface convention; no flux extrapolation was introduced. All six double-precision T21/T42 rank variants were fully rebuilt without `--link-only` into `stats/exoplasim-model-options/surface-energy-build/`, then installed after confirming shared input-package hashes. Checkpoint format 7 identifies the new configuration and field layout.

A sequential paired T21/8-rank comparison ran the saved 77-field model and the rebuilt 81-field model with identical input packages and browser defaults except a 30-minute timestep for 48 steps. All 157,696 previously published endpoint values matched exactly; maximum absolute difference was zero. The saved model, comparison script and report are `stats/exoplasim-model-options/before-surface-energy/`, `compare-surface-energy-hook.mjs` and `surface-energy-additive-comparison.json`. This verifies additive extraction at a short endpoint, not climate equilibrium or every internal variable.

The native `verify-weather.py` fixture checks all four signed energy slots and their sum against net surface heat with zero snowmelt, alongside the existing pressure and ten-layer cloud checks. The extended browser verifier checks native-default namelist omission, exact upstream override writes, zero values, invalid overrides, removal of only the intended land-albedo surface map, all 69 map definitions, signed units, synthetic monthly/annual means, checkpoint retention and obsolete-format rejection. T21's sequential 2/4/8-rank 48-step checks and paused reloads passed; the 8-rank case used explicit land/ocean/snow-ice overrides of 0.31/0.07/0.65. Report: `stats/exoplasim-model-options/report-81-21.json`. T21 elapsed times overlapped native compilation and are not performance comparisons. UI checks cover default-off controls, zero overrides, help, all four maps, downscaled display and save/clear/load. No annual model integration was needed.

T42’s 2/4/8-rank checks, the surface-file preparation fixtures and UI save/load checks also passed; report: `stats/exoplasim-model-options/report-81-42.json`. Startup/run/checkpoint intervals were 14.93/10.47/9.62 s, with no overlapping model run. These single functional checks do not establish throughput changes. A packed T42 snapshot now carries 2,654,208 bytes (81 × 8,192 × 4), up from 2,523,136 bytes at 77 fields. The albedo-help and surface-energy screenshots were visually inspected. `pnpm lint` and `pnpm typecheck` passed.


### Soil controls and precipitation/TOA components

On 2026-10-25, the browser added soil water capacity, volumetric soil heat capacity and a five-layer depth multiplier. Defaults mirror the pinned `Model.configure()` signature: capacities unset (`None`/`null`), depth multiplier 1×. Explicit water-capacity overrides write `WSMAX` and remove only `*0229.sra`; heat capacity writes `SOILCAP`; depth writes the native `[0.4, 0.8, 1.6, 3.2, 6.4]` m profile multiplied by the selected scale. Existing albedo and new capacity controls share `GcmSurfaceOverrides.tsx`, preserving the default/override interaction and contextual help. Units, default sources, input ranges and validation are described in [Browser model controls and diagnostics](exoplasim-controls.md#soil-defaults-and-overrides).

The snapshot expanded from 81 to 85 fields with direct reads of `dprc`, `dprl`, `dswfl(:,1)` and `dlwfl(:,1)`. Water cycle adds Convective and Large-scale precipitation; Radiation adds TOA solar and TOA thermal. The TOA outputs keep the native downward-positive sign. The existing Outgoing IR view stays outward-positive. These additions do not introduce precipitation or radiation estimates. Checkpoint format 8 stores the new control values and array layout.

A paired sequential T21/8-rank check ran the saved 81-field binary and rebuilt 85-field binary for 48 steps at 30 minutes with identical packaged data and otherwise default browser settings. All 165,888 previously published endpoint values matched exactly, including the shifted atmospheric slots; maximum absolute difference was zero. Saved binary, script and report: `stats/exoplasim-model-options/before-soil-precipitation/`, `compare-soil-precipitation-hook.mjs`, and `soil-precipitation-additive-comparison.json`. This checks the default endpoint, not all internal state or equilibrium accuracy.

`verify-weather.py` passed signed native fixtures for the new precipitation and TOA fields and their sums, alongside the existing pressure, cloud and surface-energy tests. Browser core checks passed all 73 map definitions, conversions, palettes, synthetic annual retention, default soil namelists, explicit overrides and invalid values, targeted surface-file removal, checkpoint retention and obsolete-layout rejection. No annual model integration was needed. Full builds use the ignored staging directory `stats/exoplasim-model-options/soil-precipitation-build/` without `--link-only`; served assets are copied only after matching shared input-package hashes.

T21’s sequential 2/4/8-rank 48-step checks and paused reloads passed with all 85 diagnostics finite; the 8-rank case used soil water capacity 0.25 m, volumetric heat capacity 3 MJ/m³/K and depth multiplier 2×, alongside the previous explicit planet/albedo settings. Report: `stats/exoplasim-model-options/report-85-21.json`. Startup/run/checkpoint intervals were 3.03/2.86/3.08 s and overlapped native compilation, so they should not be used for performance comparisons. UI checks verified default-off overrides, capacity adjustment, the 1× depth default, contextual help, new map selections, downscaled display and save/clear/load of all three soil controls. The soil-help and precipitation screenshots were visually inspected. `pnpm lint` and `pnpm typecheck` passed.

T42’s sequential 2/4/8-rank checks and the full UI save/load sequence also passed; report: `stats/exoplasim-model-options/report-85-42.json`. Startup/run/checkpoint intervals were 10.09/7.21/6.04 s with no overlapping model run. These single functional samples do not establish a throughput change. A packed T42 snapshot is now 2,785,280 bytes (85 × 8,192 × 4), versus 2,654,208 bytes at 81 fields. All six staged variants and the updated manifest were installed; their shared input data remained unchanged.


### Orbital controls and compiled atmospheric layers

On 2026-10-25, the browser added longitude of periapse (`MVELP`), generic Keplerian mode (`NGENKEPLERIAN`) and initial mean anomaly (`MEANANOM0`). Defaults match the pinned configure signature: periapse/phase unset, generic mode off. Native Earth values remain 102.7° and −2.9589°. The phase input is shown only in generic mode. Both nullable angles reuse the surface controls' default/override UI, now `GcmOverrideControls.tsx`, with contextual help. Exact semantics and angle bounds are in [Browser model controls and diagnostics](exoplasim-controls.md#orbital-geometry-and-atmospheric-layers).

Numerics now offers native 5- and 10-layer atmospheres, keeping 10 as upstream's default. `build.py --layers` writes `NLEV_ATM` and uses separate build directories; the app builder emits T21/T42 × 5/10 layers × 2/4/8 ranks under `tN/layers-L/ranks-R/`, sharing the unchanged data package per horizontal resolution. Snapshot size is 35 non-layer fields plus five fields per actual layer: 85 at 10 layers and 60 at 5. Lowest-layer humidity, layer selectors, map sampling, monthly/annual history and checkpoint metadata follow the selected vertical count. Checkpoint format 9 records the count and rejects diagnostics that disagree with the saved resolution/count. Layer maps beyond the actual model count are unavailable; switching to five clamps a higher selected map to the new bottom layer.

The initial five-layer Flang build rejected constant negative array subscripts in source branches guarded by `NLEV==20` and `NLEV>10`. For builds below ten layers, `model_source.py` omits those provably unreachable blocks before compilation; the native five-layer vertical grid and physics are retained, and ten-layer source is unchanged. The generated source diff captures this adaptation. A first browser run then stopped in the native FFSL initializer, which explicitly requires `NLEV>=6` or `NSELA=0`. Five-layer namelists now set `NSELA=0`; the existing `NQSPEC=1` spectral humidity transport remains active, and ten-layer settings are unchanged. No new vertical interpolation or wind estimate was introduced.

A sequential 48-step T21/8-rank comparison of the previous 85-field model and the layer-aware default 10-layer model used identical data and configuration except a 30-minute timestep. All 174,080 published endpoint values matched exactly, maximum absolute difference zero. Script/result: `stats/exoplasim-model-options/compare-orbits-layers-default.mjs` and `orbits-layers-default-comparison.json`; saved binary: `before-orbits-layers/`. This verifies default endpoint preservation, not equilibrium or all internal state.

A separate native-orbit check used T21/10 layers/8 ranks, 48 steps at 30 minutes, eccentricity 0.2, generic Keplerian mode and rotating illumination. Changing initial mean anomaly from 0° to 180° at periapse longitude 102.7° changed the endpoint net TOA shortwave field (largest cell difference 1,937.77 W/m²). Keeping phase 0° and changing periapse longitude to 12.7° also changed it (largest cell difference 1,918.58 W/m²). All fields remained finite. These are deliberately different startup forcings, not a controlled climate response or climatological means. Script/report: `verify-orbit-effects.mjs` and `orbits-explicit-effects.json` under `stats/exoplasim-model-options/`.

Native Fortran fixtures passed both actual layouts, including all cloud slots, lowest-layer sea-level reduction, signed energy components and precipitation/TOA sums. Reports: `weather-formulas-layers-10.json` and `weather-formulas-layers-5.json`. Maximum pressure differences from the exact hydrostatic reference were 0.05383 Pa and 0.05252 Pa respectively. Browser checks cover both horizontal grids, each count's available map modes (73/53), synthetic annual retention, default orbital omission, explicit zero phase, native parameter keys, invalid angles/counts and checkpoint resolution/layer mismatch rejection. No annual model integration was required.

T21/10-layer 2/4/8-rank 48-step checks, finite maps, orbital/control checkpoint retention and paused reloads passed. Startup/run/checkpoint intervals were 2.70/2.67/3.05 s, overlapping native compilation; they are functional-check timings, not throughput comparisons. Report: `stats/exoplasim-model-options/report-orbits-layers-21-10.json`. UI checks exercised the native layer selector, clamping between counts, conditional phase controls, help, downscaled maps and save/clear/load.

T21/5-layer 2/4/8-rank 48-step checks, finite maps, orbital/control checkpoint retention and paused reloads passed. Startup/run/checkpoint intervals were 1.94/1.83/2.34 s, overlapping native compilation; they are functional-check timings, not throughput comparisons. Report: `stats/exoplasim-model-options/report-orbits-layers-21-5.json`. UI checks exercised the native layer selector, clamping between counts, conditional phase controls, help, downscaled maps and save/clear/load.

The orbital help and five-layer selector screenshots were visually inspected. `pnpm lint` and `pnpm typecheck` passed.

T42/10-layer 2/4/8-rank 48-step checks and paused reloads passed, with startup/run/checkpoint intervals of 7.07/5.48/5.27 s. No model run or compilation overlapped these cases. These are single functional-check samples including startup and checkpoint overhead, not isolated per-step throughput measurements.

T42/5-layer 2/4/8-rank 48-step checks and paused reloads passed, with startup/run/checkpoint intervals of 4.72/4.07/3.82 s. No model run or compilation overlapped these cases. These are single functional-check samples including startup and checkpoint overhead, not isolated per-step throughput measurements.

The complete T42 report is `stats/exoplasim-model-options/report-orbits-layers-42-10-5.json`; its UI phase-toggle, five-layer map, help, downscaled display and save/clear/load checks also passed. All twelve compiled variants were installed after matching shared data hashes, and superseded `tN/ranks-R/` assets were removed. Packed T42 snapshots are 2,785,280 bytes at ten layers and 1,966,080 bytes at five (29.4% less snapshot data). This byte reduction is exact; simulation speed depends on workload, transport settings and hardware.


### Two atmosphere input modes and nine bulk gases

On 2026-10-25, Atmosphere was reorganized into Gas mixture and Pressure + gas constant modes, with nullable partial pressures in bars for H₂, He, N₂, O₂, Ar, Ne, Kr, CO₂ and H₂O. The new `GCM_ATMOSPHERE` domain shares gas masses, validation and resolution between the UI preview and namelist preparation. The model still receives its existing `PSURF`, `GASCON`, radiative `CO2` and `NO3` parameters; no new gas absorption or convection schemes were introduced. Numeric fields support trace-gas precision, and the UI shows the effective model parameters. Details and source defaults are in [Atmosphere configuration](exoplasim-atmosphere.md).

The default atmosphere now matches the pinned wrapper's no-gas-input branch: 1.011 bar, mean molar mass 28.970253 g/mol, gas constant 287.0000002469167 J/(kg·K), 300 ppm radiative CO₂ and ozone off. This intentionally replaces the earlier browser N₂/O₂/Ar/300-ppm mixture and ozone-on preset; default climate outputs are therefore not expected to be bit-identical to that earlier configuration. Earth partial pressures in help are reference examples, not defaults. Explicit zero CO₂ maps to the existing native zero-CO₂ capability, while an unset field retains the wrapper's 300-ppm fallback.

Direct mode fixes bulk pressure and gas constant, with unspecified inputs resolving to native values, and checks that optional partial pressures fit within the total. H₂O affects bulk pressure/molecular weight only; the native prognostic water cycle still determines humidity and water-vapor absorption. Ozone remains a separate, prescribed Earth-tuned choice. Pressure outside 0.1–10 bar displays the user's requested timestep guidance, and Numerics now offers 5, 10 and 15 minutes alongside 30/45, preserving the native 45-minute default. Model limitations and the distinction between modes are explained in the input help.

Checkpoint format 10 stores the nested atmosphere schema, mode and full nullable gas list. Older configuration schemas are rejected. Fortran, the 85/60-field layouts and all twelve compiled binaries are unchanged; no rebuild was needed.

`verify-atmosphere.mjs` passed independent checks of every gas's molar mass, native defaults, an Earth reference mixture, direct-mode dilution, zero CO₂, invalid inputs, pressure guidance and the absence of a direct radiation setting from bulk H₂O. It ran three sequential T21/10-layer/2-worker 48-step cases at a 5-minute timestep: native defaults; an Earth reference mixture; and direct 0.5 bar / 300 J/(kg·K) with ozone and all nine gases. All fields remained finite and atmosphere settings round-tripped exactly through checkpoints. Startup/run/checkpoint intervals were 2.54/2.89/2.55 s. These are short functional samples, not equilibrium or throughput measurements. Report: `stats/exoplasim-atmosphere/report.json`.

UI checks passed blank defaults, both modes, mode retention, numeric precision, validation, H₂O help, 5-minute selection, locked settings and save/clear/load of every partial pressure and bulk input. Native default gas constant displays as 287.000 J/(kg·K); the independently checked Earth example (0.7809 N₂, 0.2095 O₂, 0.0093 Ar and 0.0003 CO₂ bar) totals 1 bar and yields 287.0606514612487 J/(kg·K). Screenshots are under `stats/exoplasim-atmosphere/`.

T21/10-layer 2/4/8-rank 48-step checks and paused reloads also passed with the explicit former 1,000-ppm test mixture; startup/run/checkpoint intervals were 2.11/2.42/2.46 s.

T21/5-layer 2/4/8-rank 48-step checks and paused reloads also passed with the explicit former 1,000-ppm test mixture; startup/run/checkpoint intervals were 1.81/1.69/1.87 s.

T42/10-layer 2/4/8-rank 48-step checks and paused reloads also passed with the explicit former 1,000-ppm test mixture; startup/run/checkpoint intervals were 9.05/6.63/6.74 s.

T42/5-layer 2/4/8-rank 48-step checks and paused reloads also passed with the explicit former 1,000-ppm test mixture; startup/run/checkpoint intervals were 6.48/4.55/4.29 s.

The complete broader report is `stats/exoplasim-model-options/report-atmosphere-21-42-10-5.json`; map, synthetic annual history and full UI save/load checks passed. All runs were sequential. These timings include startup and checkpoint overhead, and some overlapped TypeScript verification, so they are not a throughput comparison. An earlier broader run was interrupted by a formatting-triggered development reload and was rerun after formatting finished. `pnpm lint` and `pnpm typecheck` passed.

## Climate maps and timestep temperature extrema (2026-10-26)

Climate now groups Köppen and Pasta maps, sharing monthly input preparation, downscaling, legends and hover names. The Pasta implementation and input approximations are described in [Climate classifications](exoplasim-controls.md#climate-classifications).

The snapshot hook tracks actual 2 m temperature minima/maxima every timestep and publishes interval extrema, which monthly accumulation reduces with min/max rather than averaging. Two new fields raise the snapshot layout to 87 fields at 10 layers and 62 at 5. Raw Float32 snapshot payload increases by 16,384 bytes at T21 and 65,536 bytes at T42 per publication (2.35% at 10 layers; 3.33% at 5). Checkpoint format 11 stores the new layout and unfinished extrema accumulators; older checkpoints are rejected.

All twelve variants were fully recompiled after the hook change. T42 finalization encountered a Windows mapped-file error, so those variants were built on Linux storage and copied into `public/gcm/`; the manifest download sizes were refreshed. The data packages and physical model equations are unchanged.

Native `verify-weather.py` passed at both layer counts, including extrema from unpublished timesteps and reset after publication. `verify-climate.mjs` passed 26 representative climates at every calendar rotation, 2,000 seasonal fixtures, monthly extrema preservation, both downscaling paths, a 259,200-cell display raster, hover names, and Climate/Köppen/Pasta controls. Reports: `stats/pasta/classification.json`, `stats/pasta/controls.png`, and `stats/exoplasim-model-options/weather-formulas-layers-{5,10}.json`.

Sequential `verify-model-options.mjs 21` and `verify-model-options.mjs 42` smoke runs passed 48 steps at 30-minute timesteps for 2/4/8 ranks and both layer counts, including finite fields, temperature extrema bracketing the published air temperature, component sums, checkpoint round trips and paused restart. The script uses its existing explicit atmosphere and imported test continent; detailed settings and outputs are in `stats/exoplasim-model-options/report-atmosphere-21-10-5.json` and `stats/exoplasim-model-options/report-atmosphere-42-10-5.json`.

| Resolution / layers | 2 ranks | 4 ranks | 8 ranks |
| --- | --- | --- | --- |
| T21 / 10 | 3.39 s | 2.83 s | 3.24 s |
| T21 / 5 | 1.99 s | 2.09 s | 2.69 s |
| T42 / 10 | 7.21 s | 5.16 s | 5.15 s |
| T42 / 5 | 4.22 s | 3.31 s | 3.50 s |

These are functional startup/run/checkpoint intervals, not throughput comparisons; some overlapped asset compilation. No new long-run climate or equilibrium benchmark was performed. The non-app `run-browser.mjs` benchmark does not execute this snapshot hook. `pnpm lint`, `pnpm typecheck`, and the production application build passed.

### Pasta palette and article audit follow-up

The follow-up palette audit replaced the generated colors with the exact 104 named RGB values in the supplied chaos-machine Pasta module. The classifier audit corrected full-period GInt interruption, peritropical/marginal precedence, exact threshold boundaries, ocean light counting, and the downscaled snow/sea-ice proxy. The remaining differences and selected fallback recipes are explicitly recorded in [Pasta climate maps: logic audit](pasta.md#logic-audit); this is not a claim of full parity with the author's default ExoPlaSim input processing.

`verify-climate.mjs` with the supplied reference source passed all 104 RGB comparisons, 40 representative cases at every calendar rotation, 2,000 seasonal fixtures, and the 259,200-cell display raster. The report remains `stats/pasta/classification.json`. Lint, typecheck and the production build passed. This follow-up changes TypeScript classification and palettes only; the Fortran hook, snapshot layout and model binaries are unchanged, so the twelve native-model smoke runs above were not repeated.

### Python recipe and year-length follow-up

Classification now uses nominal `yearDays / 12` Earth days per month for growth, rainfall and evaporation totals. The rotation-dependent namelist mapping uses the configured year length. Native calendar/timestep quantization remains documented in [Pasta climate maps](pasta.md).

The browser recipe now uses ASCE-style PET, native land evaporation, a converged soil-water fallback for downscaled land over source ocean, and pressure-dependent Antoine boiling. Lowest-layer humidity/wind, mean-temperature saturation and zero soil heat flux are the selected input approximations. The supplied palette and actual timestep temperature extrema remain unchanged.

The upstream fixture generator executed the actual Python functions from source SHA-256 `b22c8da54ac79f3280440246f33177e99313f82dae909e5a22177854ae8c6aa9`. All 64 PET comparisons passed, including 15/30/60/90-day durations. A separate seasonal storage fixture verifies that this port avoids the source's mutable-view convergence bug. Climate checks passed 104 palette entries, 46 climates with calendar rotations, 2,000 seasonal fixtures, year-length scaling, native evaporation selection, pressure boiling and the 259,200-cell display raster. Reports: `stats/pasta/upstream-formulas.json` and `stats/pasta/classification.json`.

Sequential T21 smoke checks passed all six layer/rank variants, including checkpoint and paused restart, using `verify-model-options.mjs 21`. Startup/run/checkpoint intervals for 2/4/8 ranks were 2.15/1.77/2.34 s at 10 layers and 1.77/1.46/2.20 s at 5 layers. These are functional smoke measurements, not equilibrium or throughput benchmarks. No Fortran, shared-memory or snapshot-hook code changed in this follow-up, so the model binaries were not rebuilt.

Final verification: pnpm lint, pnpm typecheck, pnpm build and git diff --check passed. The production build retains its existing advisory about a JavaScript chunk above 500 kB.

### Climate legend React profiling fix

The climate legend passed its full class raster through component props. React 19's development performance diagnostics expanded both old and new typed arrays when switching Köppen/Pasta. The legend now reads classes through a stable callback, matching the map's existing data-reader boundary; raster data stays in the external store or memoized classification output.

An isolated Chrome development-build comparison with 259,200 cells and React Profiler measured the legend transition at 238.66 ms before and 7.87 ms after. Diagnostic properties fell from 518,405 to 5. These are single functional samples of the legend transition, not whole-app latency guarantees or model-throughput measurements. Reports: `stats/pasta/legend-before.json` and `stats/pasta/legend-after.json`.

`verify-climate.mjs` now checks a full-size legend transition, verifies both class labels, and rejects large React diagnostic payloads. The integrated check measured 8.04 ms and 5 diagnostic properties. All existing climate/palette checks, `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.

### Daily temperature range map

Temperature now includes DTR, derived from timestep 2 m air temperatures over native rotation days (`ntspd` timesteps). Independent daily minima/maxima exclude partial days after startup/restart. Each publication carries the latest daily range, a sum of daily ranges completed since the last publication and their count. This preserves correct daily weighting even when a publication spans multiple days, and holds the last range between day completions. Monthly DTR is the ratio of accumulated sums/counts; annual DTR is the mean of twelve monthly DTR values, rather than the seasonal maximum-minus-minimum range. Daily completions follow the existing publication-based month assignment. Downscaling interpolates without applying a lapse offset. The 0–30 °C sequential display scale clips colors only, and Fahrenheit differences use 9/5 without the absolute-temperature offset.

The three new fields expand the layout to 90 fields at 10 layers and 65 at 5. Float32 publication payload increases by 24,576 bytes at T21 or 98,304 bytes at T42, respectively 3.45%/4.84% relative to the previous 87/62-field layouts. Checkpoint format 12 stores the new layout; older formats require a new run. Native in-progress daily buffers are reinitialized after load; incomplete first days are excluded instead of treated as full days. Completed-month diagnostics remain in the checkpoint.

Native `verify-weather.py` checks passed at both layer counts. A two-day fixture uses different mean-temperature baselines and daily ranges of 20/10 °C, publishes both together as sum 30/count 2, then verifies last-range holding and zero sum/count on the following publication. It also verifies unpublished timesteps and exclusion of an initial partial day. Synthetic browser checks passed daily-count weighting, monthly/annual averages, Celsius/Fahrenheit differences, both climate classifications, all 104 requested Pasta colors, and the DTR controls. The existing legend profiling boundary remains at five diagnostic properties.

All twelve Wasm variants were rebuilt without `--link-only`, using Linux storage before copying the generated assets into `public/gcm/`. Data-package SHA-256 values were unchanged and all manifest download sizes were checked against the resulting files. Sequential `verify-model-options.mjs 21` and `verify-model-options.mjs 42` runs exercised 48 native steps per layer/rank combination, checked finite nonnegative DTR fields, integer completed-day counts and at least one captured full day, then verified checkpoints and paused restarts.

| Resolution / layers | 2 ranks | 4 ranks | 8 ranks |
| --- | --- | --- | --- |
| T21 / 10 | 2.16 s | 2.06 s | 1.97 s |
| T21 / 5 | 1.40 s | 1.44 s | 1.76 s |
| T42 / 10 | 8.68 s | 6.12 s | 4.98 s |
| T42 / 5 | 5.02 s | 4.10 s | 3.47 s |

These startup/run/checkpoint intervals are short functional samples, not equilibrium or throughput measurements; T21 samples overlapped compilation. Reports: `stats/exoplasim-model-options/report-atmosphere-21-10-5.json`, `stats/exoplasim-model-options/report-atmosphere-42-10-5.json`, and `stats/pasta/classification.json`. The non-app `run-browser.mjs` benchmark does not exercise this snapshot hook, so it was not used to estimate DTR overhead.

Final UI/save-load checks passed for both test runs. The integrated DTR/climate report passed with a 259,200-cell raster and five legend diagnostic properties (8.59 ms isolated switch). pnpm lint, pnpm typecheck, pnpm build and git diff --check passed. The production build retains its existing chunk-size advisory.

## Local CUDA feasibility probe

On 2026-10-27, the existing Ubuntu 22.04 WSL2 environment exposed the machine's RTX 2070 SUPER (compute capability 7.5, 8,192 MiB VRAM, Windows driver 610.88). A one-thread CUDA Driver API/PTX probe computed `1 + 2**-40`: FP64 returned `1.0000000000009095`, exactly matching the host double result, while FP32 returned `1.0`. Allocation, kernel launch, synchronization and device-to-host copy passed without installing a toolkit. Artifacts: `stats/cuda-research/probe.py` and `stats/cuda-research/probe.json`. This is an arithmetic/access check, not a model validation or performance measurement. Toolchain and porting findings are in [CUDA feasibility research](exoplasim-cuda.md).

## WebGPU integration measurements

On 2026-10-28, GPU startup optimization reduced ten-layer pipeline creation from 383 to 129 requests. Local time to first snapshot with Earth climatology off changed from 1.91 s to 1.35–1.55 s at T21 and from 3.93 s to 1.71–2.19 s at T63. These are short development-server samples with browser/driver caches, not steady-state throughput measurements. Workloads, variability, selective-download sizes and numerical checks are recorded in [WebGPU startup](exoplasim-webgpu-startup.md).

A subsequent trial overlapping state upload with compilation did not show a repeatable further improvement in paired checks. It preserved output fingerprints, but was not retained in the product. Dependencies and reproducible test-only commands are recorded in [the overlap experiment](exoplasim-webgpu-startup.md#further-overlap-experiment-2026-10-28).

The subsequent map-loading change moved display-grid and boundary preparation into background workers and added a reduced-motion-aware map skeleton. A local T63 development check measured 71 ms to toggle the settings panel during startup and a longest main-thread long task of 110 ms; the production build measured 56 ms and 79 ms respectively. Numerical parity, cancellation and CPU startup/checkpoint checks are described in [Map loading and responsiveness](exoplasim-webgpu-startup.md#map-loading-and-responsiveness).

On 2026-10-27, the integrated production page measured T21 at 36.28 model days/s on GPU with ten layers, 51.00 with five layers, and 2.43 on CPU with ten layers. T42 GPU measured 11.83 with ten layers and 16.89 with five. Chrome 156.0.8078.48 used the NVIDIA Turing adapter; all readings use 45-minute timesteps, publication every four steps, and ten seconds of steady execution. Save/load continuation passed in all five configurations. T42 five-layer pause remained above 100 ms (139 ms worst of ten presses in the isolated repeat). Exact workloads, reports, comparison limits and regression results are in [WebGPU integration](exoplasim-webgpu-integration.md#local-measurements-2026-10-27). The non-app `run-browser.mjs` benchmark does not execute the GPU runner or these diagnostic readbacks, so it was not used to attribute their overhead.

## Checkpoint loading worker verification (2026-10-28)

Checkpoint file reading, decoding, validation, annual means and climate classifications now run in the existing preparation worker. The file is sent as a `File`; returned diagnostic, restart and terrain buffers use transfer lists. The UI enters “Reading checkpoint” immediately, and Clear, another load or unmount cancels pending preparation.

`CHECKPOINT_UI=1 node scripts/exoplasim-webgpu/verify-checkpoint-loading.mjs stats/exoplasim-webgpu/page-build-gpu-t42-l10/exoplasim-t42-layers10-year0002-month06.ckpt` verified an 83,203,055-byte GPU T42/10-layer checkpoint. In one local headless Chrome sample, worker preparation took 126 ms; a 10 ms UI timer fired 12 times and the observer recorded no main-thread tasks of 50 ms or longer during that preparation. Every decoded value, restart byte, annual mean and classification matched the synchronous reference. Invalid-file rejection, cancellation and loading the actual `/gcm` page into a paused run followed by Clear passed. Report: `stats/checkpoint-loading/verification.json`. This measures worker preparation, excluding the separately verified model startup and rendering; it is not a model-throughput benchmark. No Fortran or Wasm changes were needed.
