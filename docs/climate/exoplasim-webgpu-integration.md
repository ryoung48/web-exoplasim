# WebGPU integration

The integration combines WebGPU commit `b0d48c5` with main at `56e5ccc`. The GPU/CPU engine selector defaults to GPU when a WebGPU adapter is available. The CPU engine retains main's native diagnostics and controls. Both engines use the current terrain object, planetary gravity, and resolution/layer selection. CPU modules load from `tNN/layers-L/ranks-R/`; the input data remains shared at `tNN/exoplasim.data`.

## Diagnostic scope

The GPU also supports [T63 at 192 × 96](exoplasim-webgpu-t63.md), with 5 or 10 layers and a 20-minute starting timestep. Its climatologies are resampled from T42; CPU T63 assets are not built.

The GPU snapshot uses 49 surface slots plus five slots per atmospheric layer: 74 fields at five layers and 99 at ten. Existing model arrays supply evaporation, runoff, forest cover, leaf area, snowfall, snowmelt, ice thickness, glaciers, radiation/heat fluxes, separate precipitation components, and layer temperature, winds and clouds. Copying these diagnostics does not add climate physics.

Pasta also requires interval temperature minima/maxima and lowest-layer relative humidity. The snapshot kernel tracks actual 2 m temperature on every main-loop step, including unpublished steps. It accumulates complete native rotation-day ranges and resets publication sums/counts after publishing, matching `gcm_publish.f90`. Initial partial days are excluded. The same dispatch packs output only on publication steps. Lowest-layer relative humidity reuses the precipitation module's saturation shader and physical constants and is calculated only on publication steps.

Sea-level pressure reduction and relative humidity at the other atmospheric levels are deliberately not implemented for GPU. Their reserved snapshot slots remain zero and their map views are hidden in GPU mode; those slots must not be interpreted as physical observations. The standalone Relative humidity view uses the lowest layer and remains available for Pasta's shared input. The CPU engine exposes all its diagnostics.

The GPU engine now supports tidally locked illumination, generic Keplerian orbits and phase, the native 365-day calendar, and nonnegative initial glacier heights. Their native conventions, implementation and focused parity tests are documented in [GPU input support](exoplasim-webgpu-inputs.md).

Glacier formation during a continuous run is incomplete: GPU initialization and glacier removal are implemented, but native snow-persistence tracking and end-of-session promotion are missing. Continuous CPU sessions also defer the native persistence lifecycle. See the [glacier lifecycle audit](exoplasim-glaciers.md) for the reproduced behavior and checkpoint evidence.

Both engines support the shared Storm climatology toggle and nine diagnostic maps. The GPU computes these every model step before physics output conversion. See [Storm climatology](exoplasim-stormclim.md) for conventions, verification and costs.

## Checkpoints

CPU uses checkpoint format 16; GPU uses format 17 with main's terrain, layer metadata, climate averages and field validation. Both restarts carry glacier snow persistence ([Glacier lifecycle](exoplasim-glaciers.md)). The GPU restart includes the complete model state and temperature-tracking arrays, preserving partial days and publication intervals across save/load. Earlier formats are rejected. Loading selects the engine that saved the checkpoint.

## Verification

- `pnpm lint`, `pnpm typecheck`, and `pnpm build` check the integrated TypeScript and production bundle.
- `node scripts/exoplasim-webgpu/verify-snapshot.mjs` checks five- and ten-layer packing against assigned model-array values; exact extrema and daily ranges with unpublished peaks and day boundaries; initial partial-day exclusion; lowest-layer humidity against an independent formula; and identical diagnostic continuation after restoring a GPU restart. It also runs custom terrain with gravity, radius, albedo and soil overrides for at least 48 main steps at both resolutions and layer counts, checking finite snapshots and temperature extrema.
- `PREVIEW=1 ENGINE=gpu LAYERS=10 TRUNCATION=21 node scripts/exoplasim-webgpu/verify-page.mjs` checks the production page, steady throughput over ten seconds, pause latency, checkpoint continuation, diagnostics, Pasta availability after twelve closed months, and rejection of unsupported checkpoints. Change `ENGINE`, `LAYERS`, and `TRUNCATION` for the other configurations. On Windows set these environment variables in PowerShell before running Node.
- Checkpoint comparisons enable lightweight publication fingerprints in the worker served by the harness after throughput/pause measurements. This instrumentation is absent from the product and makes every published step comparable despite adaptive batch sizes.
- Existing regressions are `scripts/exoplasim-wasm/verify-model-options.mjs` and `scripts/exoplasim-wasm/verify-climate.mjs`, served by Vite with `GCM_TEST_URL` configured as described in those scripts.

Reports are written under `stats/exoplasim-webgpu/`. Run browser simulations sequentially and close other running `/gcm` simulations before measuring. Long climate validation remains the original port's scope and limitations, described in [the port reference](exoplasim-webgpu.md#climate-v5-t21-2026-10-27).

## Local measurements, 2026-10-27

Production build, Chrome 156.0.8078.48, NVIDIA Turing adapter (RTX 2070 SUPER), default 45-minute steps and publication every four steps, ten seconds of steady throughput:

| Engine | Resolution | Layers | Model days/s | Pause max | Checkpoint continuation |
| --- | --- | --- | --- | --- | --- |
| GPU | T21 | 10 | 36.28 | 81 ms / 10 presses | Identical |
| GPU | T21 | 5 | 51.00 | 70 ms / 3 presses | Identical |
| GPU | T42 | 10 | 11.83 | 94 ms / 3 presses | Identical |
| GPU | T42 | 5 | 16.89 | 139 ms / 10 presses | Identical |
| CPU | T21 | 10 | 2.43 | 18 ms / 3 presses | Identical |

Reports: `stats/exoplasim-webgpu/page-build-{gpu,cpu}-tNN-lL/page.json`. T21 GPU runs also verified the Pasta controls after twelve completed months. The T42 runs were shorter than a model year, so the separate classification regression and T21 runs cover Pasta availability. The short custom-terrain matrix is in `stats/exoplasim-webgpu/snapshot/snapshot.json`.

T21 ten-layer throughput is about 17% below the original port's recorded 43.9 days/s, with main's larger snapshots, climate processing and UI now included. This is not an isolated measurement of diagnostic-kernel overhead. An earlier integration run before adding Pasta humidity reached 42.79 days/s; single-run variation and differing workload prevent attributing the difference to humidity alone. No repeated statistical performance comparison was run.

T42 five-layer pause exceeds the original T21 100 ms target. An initial run overlapping lint reached 188 ms; the isolated repeat still reached 139 ms, with eight of ten presses above 100 ms. Throughput remains the priority for this integration; the batch budget is unchanged at 20 ms with two batches in flight. The harness records this failed latency criterion explicitly without treating it as a checkpoint or numerical failure.

The CPU model-option regression passed T21 at 5/10 layers and 2/4/8 workers, including custom terrain, atmospheric and surface controls, every palette, averages, and paused restart. The climate regression passed 46 representative cases and 2,000 seasonal fixtures, monthly extrema, daily ranges, both downscaled schemes and a 259,200-cell display raster. External palette and upstream Python fixture comparisons were not supplied to this run.
