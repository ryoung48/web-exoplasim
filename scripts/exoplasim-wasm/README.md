# Building ExoPlaSim for the browser

These scripts compile the [ExoPlaSim](https://github.com/alphaparrot/ExoPlaSim) Fortran climate model (pinned to commit `5f8dff4`) to WebAssembly. They produce the assets the `/gcm` page loads and the variants used for benchmarking. For design, measurements and results, see [docs/climate/exoplasim-wasm.md](../../docs/climate/exoplasim-wasm.md).

## Requirements

- Windows with WSL and an `Ubuntu` distribution. The toolchain runs inside WSL; the page and benchmarks run in Windows.
- In Ubuntu: `bash`, `curl`, `make`, `gcc` and `python3`. Install them with `sudo apt install build-essential curl python3` if missing.
- About 6 GB free under `/var/tmp` in WSL for the toolchains, sources and build directories.
- For benchmarks only: Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`, which the repo's Playwright dependency drives.

## One-time setup

From the repository root:

```powershell
wsl -d Ubuntu -- bash scripts/exoplasim-wasm/setup.sh
```

This installs everything under `/var/tmp/chaos-exoplasim-wasm/` in WSL and changes nothing in the repository: micromamba environments for Flang 19.1.7 (Wasm and native), Emscripten 4.0.9 and Binaryen 123, plus the ExoPlaSim and Flang runtime sources. It is safe to rerun; finished steps are skipped.

## Build the `/gcm` page assets

```powershell
pnpm build:gcm-wasm
```

This runs `build_app.py`, which builds T21 and T42 with 5 and 10 atmospheric layers for 2, 4 and 8 workers into `public/gcm/`:

```
public/gcm/
  manifest.json        resolutions, precision, worker counts, download sizes
  COPYING              ExoPlaSim's licence
  t21/exoplasim.data   T21 namelists and surface files, shared by every variant
  t21/layers-L/ranks-N/  exoplasim.js + exoplasim.wasm for L layers and N workers
  t42/...              the same for T42
```

Building both layer counts adds six variants; full build time depends on cached objects and hardware. For a single layer count use `--layers 10` or `--layers 5`. Later builds only recompile changed sources. Useful options, appended to the command (pnpm forwards a literal `--`, which `build_app.py` rejects):

| Option | Effect |
| --- | --- |
| `--truncations 21` | Build one resolution and keep the other's manifest entry |
| `--ranks 4 8` | Worker counts to build (each must divide the number of latitudes) |
| `--layers 5 10` | Build both vertical resolutions; default order is 10 then 5 |
| `--precision 4` | Single precision: about 16% faster at T42, but multi-year stability is unchecked |
| `--link-only` | Relink unchanged interfaces after link-flag changes. Use a full build after Fortran, shared-memory JS, snapshot hooks or layer-count changes |

For example, `pnpm build:gcm-wasm --truncations 21 --link-only`.

Then start the app with `pnpm dev` and open `/gcm`. The page loads the manifest and downloads only the horizontal resolution, atmospheric layer count and worker count it uses.

Only use `--link-only` when the Fortran sources and `mpimod_shm.f90`/`gcm_publish.f90` interfaces are unchanged. Relinking old objects against a changed `library_shm.js` or `library_gcm.js` produces a build whose calls disagree on their arguments.

## Benchmark and research builds

`build.py` builds one variant into any output directory:

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/build.py --truncation 42 --ranks 8 --output stats/exoplasim-wasm/t42-8
```

| Option | Default | Effect |
| --- | --- | --- |
| `--truncation 21\|42` | 21 | Model resolution (64×32 or 128×64) |
| `--ranks 1\|2\|4\|8\|16` | 1 | Shared-memory workers. 1 is the original serial build |
| `--layers 5\|10` | 10 | Compiled atmospheric layer count |
| `--precision 4\|8` | 8 | Bytes per default `REAL` |
| `--app` | off | ES module with live snapshots, as used by `/gcm` |
| `--target native` | wasm | Native Flang reference build, serial only |
| `--profile` | off | Keep function names for Chrome CPU profiles |
| `--frontend-opt 0\|2` | 2 | Flang optimization level for the emitted IR; files in `FRONTEND_O0_FILES` stay at 0 |
| `--stack-mib`, `--initial-memory-mib` | sized from points per rank | Override the per-rank stack and initial memory |
| `--link-only` | off | Relink only |

Run a non-app variant in headless Chrome:

```powershell
$env:EXOPLASIM_OUT = 'stats/exoplasim-wasm/t42-8'
node scripts/exoplasim-wasm/run-browser.mjs 480
```

The argument is the step count. Environment options: `EXOPLASIM_MPSTEP` (timestep in minutes, default 30), `EXOPLASIM_NRADINT` (radiation every N steps, default 1), `EXOPLASIM_RUN` (label for the saved reports), `EXOPLASIM_REFERENCE` (directory to compare fields against), `EXOPLASIM_PROFILE=1` (record a CPU profile), `EXOPLASIM_SPIN` (barrier spin count) and `EXOPLASIM_TIMEOUT_MINUTES` (default 10). Reports are written to the output directory, which is gitignored under `stats/`.

The five-layer Flang build omits two source branches whose conditions require 20 or more than 10 layers. Their constant negative subscripts fail compilation at 5 layers even though those branches cannot execute. This preserves the native five-layer calculation and leaves ten-layer source unchanged. The patch is applied in `model_source.py` and included in the saved source diff.

## Checks after changing the build

For atmospheric composition and direct bulk inputs, see [Atmosphere configuration](../../docs/climate/exoplasim-atmosphere.md).

For browser controls, map fields, and checkpoint verification across every app variant, see [Browser model controls and diagnostics](../../docs/climate/exoplasim-controls.md#save-format-and-verification).

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-runtime.py
```

This compiles `runtime-check.f90` against both Fortran runtimes and checks array assignment: the fast fill paths, strided and reversed sections, aliasing, signed zero, reallocation, and both precisions.

For a numerical check, run two steps or one model day (48 steps at 30 minutes) of a changed variant. Compare its `browser-N*.json` fields with an earlier report through `EXOPLASIM_REFERENCE`, or with the comparison scripts described in the reference doc.

## Files

| File | Purpose |
| --- | --- |
| `setup.sh` | One-time toolchain and source download |
| `build.py` | Copies and patches the ExoPlaSim sources, compiles, links one variant |
| `build_app.py` | Builds the `/gcm` assets and manifest |
| `compile.py` | Flang → LLVM IR → Wasm object, repairing runtime ABI mismatches |
| `runtime.py` | Builds the Flang runtime with matching descriptors and the fast array fill |
| `mpimod_shm.f90`, `library_shm.js` | Shared-memory replacement for ExoPlaSim's MPI module |
| `gcm_publish.f90`, `library_gcm.js` | Live snapshots, pause and checkpoint shutdown for `/gcm` |
| `worker.js`, `run-browser.mjs` | Headless Chrome benchmark runner |
| `runtime-check.f90`, `verify-runtime.py` | Runtime assignment checks |
