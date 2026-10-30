# Storm climatology diagnostics

The Model section's **Storm climatology** toggle enables the same `GcmConfig.stormclim` input for CPU and GPU. It defaults to false and writes `NSTORMDIAG = 0/1` to `hurricane_namelist`. The CPU runs its native `hurricanestep`; the GPU runs `STORM` after carbon and surface physics, immediately before dimensional tendencies are converted back to model units. Both calculate diagnostics every step, including steps without a published snapshot. `HC_CAPTURE = 0` keeps automatic storm capture disabled.

These fields describe conditions favorable for tropical cyclones. They do not add resolved storms, storm tracks, or new atmospheric physics. The definitions follow [ExoPlaSim's pinned hurricane module](https://github.com/alphaparrot/ExoPlaSim/blob/5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff/exoplasim/plasim/src/hurricanemod.f90), rather than replacing it with a newer potential-intensity implementation.

## Fields and conventions

Enabling the toggle makes the Storm environment map group available on either engine. Each snapshot reserves nine fields, after the existing 40 surface fields and before atmospheric layers. Disabled runs leave these fields zero and keep the map group disabled. Monthly and annual maps use the existing snapshot averages; they are not averages of every unpublished step.

| Field | Native array | Definition | Display range |
| --- | --- | --- | --- |
| CAPE | `capen` | Environmental reversible-ascent CAPE, J/kg | 0–5,000 |
| Neutral buoyancy pressure | `lnb` | Environmental parcel's neutral-buoyancy pressure, hPa | 0–1,000 |
| Maximum potential intensity | `mpoti` | Potential maximum wind speed, m/s | 0–100 |
| Entropy deficit | `chim` | Normalized midtropospheric entropy deficit | 0–2 |
| Absolute vorticity | `laav` | Signed `gz * ww` nearest sigma 0.85, s⁻¹ | −0.0002–0.0002 |
| Ventilation index | `venti` | Shear × entropy deficit / potential intensity | 0–0.3 |
| Ventilation-reduced intensity fraction | `vrmpi` | Dimensionless fraction of potential intensity | 0–1.2 |
| Genesis potential index | `gpi` | Native vorticity, relative-humidity, intensity and shear expression | 0–10 |
| Tropospheric wind shear | `shear` | Absolute difference in wind **speeds** nearest sigma 0.2 and 0.85, m/s | 0–50 |

These color ranges are fixed visualization choices, not clipping of the stored diagnostics or physical acceptance limits. The vorticity palette spans both hemispheres. Wind quantities use the shared metric/imperial speed formatter. CAPE retains J/kg, pressure retains hPa, and vorticity is formatted in units of 10⁻⁵ s⁻¹ in both unit systems.

The port retains upstream's treatment of `dq` as mixing ratio, its nearest-sigma selection, and its fixed hurricane thermodynamic constants: CPD 1005.7 J/(kg·K), modified liquid-water heat capacity 2500 J/(kg·K), water-vapor gas constant 461.5 J/(kg·K), latent heat at freezing 2.501 × 10⁶ J/kg and temperature derivative −630 J/(kg·K). Dry-air RD comes from the selected atmosphere, with epsilon = RD/461.5. Ck/Cd defaults to 0.9 and the ventilation threshold to 0.145, as in the pinned source. The declared native `top` parameter does not actually discard levels: its minimum of `P - top*MSL` selects the topmost model level. The GPU preserves that behavior.

The saturated parcel solver retains the 0.001 K convergence test, 0.3 entropy step for the first two iterations, and 501-iteration bailout. The pressure solver retains 970 hPa initialization, 1000 hPa parcel-pressure cap, 0.5 hPa convergence test, and bailouts after 201 iterations or below 400 hPa. These limits come directly from upstream. A failed CAPE ascent returns zero energy and the native pressure/temperature fallback; an unsuitable dry/cold parcel returns zero CAPE and −1 neutral-buoyancy pressure. Surface temperatures at or below 5 °C or profiles at or below 100 K return intensity −1. CAPE and neutral-buoyancy outputs on those early exits are explicitly initialized to −1 in the shared native source patch and GPU, replacing undefined native outputs. Hover readouts show these −1 CAPE/pressure/intensity values as unavailable. They remain sentinels in stored fields and existing averages.

The GPU expresses the real part of upstream's principal complex cube roots as

`2/sqrt(3) * cos(acos(-VI/VITHRESH)/3)`

for `0 < abs(VI) < VITHRESH`. It returns zero outside that open interval, including VI = 0, matching upstream's explicit real/imaginary-component condition. This retains the native zero-shear discontinuity instead of silently substituting a physical limit. Float rounding can affect a classification exactly at a threshold.

## Persistence and builds

Snapshots contain 49 surface fields plus five fields per atmospheric layer: 74 fields with five layers, 99 with ten. Checkpoint formats are CPU 16 and GPU 17. Earlier formats are rejected; their layouts cannot represent the new fields. Saved configuration includes the toggle, and GPU restarts include all nine diagnostic arrays. Checkpoint loading restores the saved engine and settings and remains paused.

The CPU snapshot hook changed, so rebuild all served variants with `pnpm build:gcm-wasm`, without `--link-only`. The normal build covers T21/T42, five/ten layers and 2/4/8 workers. GPU assets require no separate shader build beyond the normal application build.

## Verification

Run browser simulations sequentially with other `/gcm` simulations stopped or paused.

1. `node scripts/exoplasim-webgpu/verify-storm-runs.mjs` runs 48 main steps at T21/T42/T63 and five/ten layers, using the deterministic custom continent in that script. It checks that enabling diagnostics changes no other model array, that complete GPU restart state round-trips exactly, and that the shared CPU/GPU runners enable and publish the fields at T21/T42 with both layer counts and 2/4/8 workers, plus T21/T42/T63 GPU runners. It records isolated GPU timestamps for three enabled/disabled repetitions and saves dimensional model columns.
2. `node scripts/exoplasim-webgpu/verify-storm.mjs --runs` compares 44 synthetic columns plus 24 saved model columns with native gfortran f64 compiled from the pinned source. Synthetic profiles cover tropical, warm, cold, hot, dry, stable, low-pressure, humid, invalid-cold, reversed-vorticity and zero-shear conditions at both layer counts and RD = 287/189 J/(kg·K). GPU snapshot packing is checked against all nine outputs. The native harness is `scripts/exoplasim-webgpu/storm-reference.py`, run in WSL Ubuntu with gfortran. Tests require finite GPU outputs and absolute-plus-relative agreement: 0.5% relative plus 5 J/kg CAPE, 1 hPa neutral-buoyancy pressure, 0.2 m/s intensity, 10⁻⁹ s⁻¹ vorticity, 0.0001 m/s shear, or 0.005 for the other indices.
3. `wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-weather.py` checks native snapshot packing and existing weather formulas with both layer counts.
4. Set `STORMCLIM=1`, `PAUSES=2`, and `ENGINE=gpu` or `ENGINE=cpu`, then run `node scripts/exoplasim-webgpu/verify-page.mjs`. It exercises the visible toggle, all nine maps, checkpoint configuration and continuation, finite snapshots, and rejection of unsupported formats. The default is T21 with ten layers; use `LAYERS` and `TRUNCATION` for other configurations. Set environment variables with `$env:NAME = 'value'` in PowerShell.
5. Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.

Reports and screenshots are under `stats/exoplasim-webgpu/storm/` and the existing page verification directories. Measurements and their limitations are recorded in [the Wasm measurement log](exoplasim-wasm.md#storm-climatology-port-2026-10-29). This is column-level numerical validation and integration coverage, not a multi-year climatological validation of cyclone genesis rates.
