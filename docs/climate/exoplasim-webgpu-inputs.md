# WebGPU input support

The GPU engine supports the page's fixed illumination, substellar longitude, generic Keplerian orbit, initial orbital phase, and native 365-day calendar settings. Initial glacier heights at or above zero also follow native initialization instead of being rejected. Radiation remains fixed to every model step in both engines.

## Orbital and illumination conventions

`calendar/solar/` ports `solang`, `gen_orb_decl` and `newtonraphson` from ExoPlaSim commit `5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff`, `plasim/src/radmod.f90`. The normal Berger/CCM orbital approximation remains the default. Generic Keplerian mode solves for eccentric anomaly with the native initial guess, derivative floor, convergence tolerance and iteration limit, then computes true anomaly, stellar-distance factor, solar longitude and right ascension. The initial mean anomaly applies in that mode.

Fixed illumination uses the native `NFIXED` convention: the declination used for the solar zenith is the orbit's obliquity, and longitude comes from `FIXEDLON`. Generic Keplerian mode also subtracts right ascension from the hour angle. When both switches are enabled, the native generic-orbit routine fixes true anomaly to zero and the stellar-distance factor to one. The solar-zenith shader retains the native hour-angle wrapping order and fixed-mode pi offset.

Orbital calculations run on the CPU in f64 and feed the existing radiation-step buffer. Fixed illumination uses a pipeline constant in the existing solar-zenith dispatch. These features add no radiation passes or GPU dispatches. No new throughput benchmark was run for this change.

## Calendar

`calendar/date/` ports `step2cal`, `cal2step`'s month-start behavior and `momint` from `plasim/src/calmod.f90`. A derived model day count of exactly 365 selects the Gregorian calendar, including leap years, century exceptions and the native year-zero epoch. Other day counts retain the rescaled 360-day calendar. Gregorian surface-climatology interpolation uses the actual lengths of the current and neighbouring months.

The year-length slider now uses one-day increments so 365 can be selected. The existing rotation-to-model-calendar mapping still applies: the orbital period entered in Earth days and the derived model day count are not necessarily identical for non-one-day rotations. Climate classification retains the existing nominal `yearDays / 12` month-duration convention shared with CPU; this change does not replace it with calendar-weighted classification.

## Initial glaciers

Initialization follows `glacierini` in `plasim/src/glaciermod.f90`. For `ICESHEETH >= 0`, cells with nonzero ground geopotential receive the requested initial water-equivalent snow/ice depth and a glacier flag; exactly zero-ground cells receive zero depth and no glacier flag. Negative `ICESHEETH` preserves the existing initialization from surface files and the minimum glacier depth. Existing glacier-topography and spectral-orography calculations then consume that state.

Positive initial heights also remove the native wrapper's prescribed surface files ending in `0174.sra`, `1740.sra`, `0210.sra` and `0232.sra`, following `Model.configure()` in the pinned `exoplasim/__init__.py`. CPU and GPU share `runner/inputs/` for this rule and the existing albedo/soil-capacity file overrides.

The native land snow cap remains in effect. With the default `DSMAX = 5` metres water equivalent, a much deeper initial sheet can cause the native artificial snow-cap cooling to produce invalid temperatures. A 20 m test exposed that behavior; the GPU reproduces the native cap rather than silently changing it. Thick-sheet experiments need a compatible native snow-cap setting. Large-height initialization itself is checked independently of subsequent model stability.

## Verification

Generate independent native fixtures in WSL:

```powershell
wsl -d Ubuntu -- python3 scripts/exoplasim-webgpu/native-input-fixtures.py
node scripts/exoplasim-webgpu/verify-inputs.mjs
```

The generator compiles the actual pinned Fortran calendar/orbital routines and the glacier-initialization block with gfortran in f64. It writes `stats/gpu-inputs/native.json`; the verifier writes `stats/gpu-inputs/verification.json`.

- 672 calendar cases compare month starts, dates and monthly interpolation across normal/leap years, 100/400-year boundaries, and 360/365/720-day settings.
- 350 orbital cases cover both switches separately and together, phases from -360 to 360 degrees, multiple steps, and eccentricities through 0.95. TypeScript ephemerides and radiation parameters match the native f64 fixtures within `2e-12` relative to at least unit scale.
- The actual GPU solar-zenith kernel is compared at 24 grid points for each of those 350 cases. Maximum observed absolute cosine error is approximately `9.62e-7`, below the `2e-6` check.
- Initial glacier masks and water-equivalent depths match native fixtures for 0, 2 and 100 m, including exactly zero and tiny nonzero geopotential. Shared surface-file preparation has separate fixed-input checks.
- Full GPU runs exercise each feature at T21/T42 and 5/10 layers for at least 48 main steps. The glacier runs retain Earth climatologies to exercise file filtering; their initial depth is 3 m, within the native snow cap.
- Combined Keplerian, Gregorian and glacier settings resume identically from checkpoints, with fixed illumination both off and on. Comparisons hash every snapshot value at common published steps.
- A browser UI check enables Keplerian phase and fixed illumination, selects year 365 and starts the real GPU worker. It checks the applied namelists and finite output.

These are input, numerical-convention and short-run regression checks. They do not establish equilibrium-climate agreement for every new parameter combination.
