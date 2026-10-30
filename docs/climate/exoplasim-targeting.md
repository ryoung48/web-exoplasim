# Automatic temperature targeting

Enter **Desired temperature** in the Atmosphere input section to enable automatic CO₂ targeting on either CPU or GPU. The input uses the selected Celsius/Fahrenheit display units and stores kelvin. Blank means fixed CO₂. The goal is the annual, area-weighted global **surface** temperature, rather than 2 m air temperature or a local temperature.

The run panel shows the goal, recent trial mean, current CO₂, the most recent change as before → after with a signed ppm difference, total change from the starting concentration, adjustment count and settling progress. An adjustment in flight is labelled Next CO₂ change. Reaching the goal or a search limit pauses the run. Resume continues at the final CO₂ without restarting the search; Clear allows a new goal/configuration.

The approach follows the run–adjust–continue workflow described in [Worldbuilding Pasta's ExoPlaSim tutorial](https://worldbuildingpasta.blogspot.com/2021/11/an-apple-pie-from-scratch-part-vi.html), under Dialing in the Climate and Script Templates. It preserves the atmosphere, ocean, soil, ice and simulation date between trials. Hysteresis can prevent a requested temperature from being a stable accessible climate; the controller reports a limit rather than claiming success at a transient crossing.

## Trial assessment and search

Each trial discards the calendar year containing its first snapshot, including the year spanning a forcing change. Only subsequent complete annual means feed assessment. Earlier diagnostics remain available as history, and the equilibrium readout filters its assessment to the current forcing. Saving does not restart the assessment window.

The following are explicit engineering defaults, not newly measured climate sensitivities:

| Parameter | Value | Reasoning |
| --- | --- | --- |
| Goal tolerance | ±0.5 K (±0.5 °C / ±0.9 °F) | Matches the tutorial's stated target interval; avoids chasing hundredths of a degree in a chaotic low-resolution model. |
| Minimum trial | 20 complete years | Allows slab-ocean/ice adjustment before accepting a match and exceeds the existing balance assessor's 14-year minimum. |
| Evaluation window | Last 10 complete years | Smooths interannual variation; follows the decade-scale averaging already used by `GCM_BALANCE`. |
| Temperature stability | Difference between the first and second five-year means ≤0.2 K | Requires decadal drift to be smaller than the target's half-width. |
| Mean energy imbalance | Absolute TOA and surface means each ≤1 W/m² over the last 10 years | Prevents accepting a constant but substantial residual imbalance, which a slope-only test can accept. It is a pragmatic controller threshold, not a guarantee of exact equilibrium. |
| Energy-balance drift | Existing `GCM_BALANCE.assess`, threshold 5×10⁻⁴ W/m²/year at TOA and surface | Reuses the pinned ExoPlaSim balance algorithm already implemented in the application. |
| Trial limit | 200 complete years | Bounds waiting for a climate that does not meet settling checks; longer/deeper-ocean climates may need different settings in a future revision. |
| Expansion | CO₂ ×2 when cold, ÷2 when warm | Explores logarithmic concentration space without assuming a universal climate sensitivity. |
| Bracket step | Geometric mean of the largest cold CO₂ and smallest warm CO₂ | Bisects in logarithmic CO₂; reversed warm/cold ordering stops the search. |
| Concentration bounds | 0.001–100,000 ppm | Positive floor permits logarithmic search; upper bound limits automatic exploration to 10% CO₂. This corresponds to 0.1 bar only at 1 bar total pressure and is not a validated upper pressure limit for the radiation scheme. An initial zero is allowed; further cooling at zero stops. Initial concentrations above the upper bound are rejected. |
| Adjustment limit | 24 | From the native 300 ppm, reaches the upper bound in nine doublings and leaves further trials to refine a bracket. Unusual initial concentrations can exhaust this budget sooner. |
| Minimum logarithmic change | 0.001 | Stops when concentration steps shrink to roughly 0.1%, preventing indefinite refinement at a discontinuous ice transition or a concentration bound. |

An unsettled climate never triggers a forcing adjustment solely because its instantaneous temperature crosses the goal. Missing annual years, reversed climate response, exhausted trials/adjustments and concentration or refinement limits produce a visible explanation and pause. A model instability retains the engine's existing failed status.

## Atmosphere and engine continuation

Targeting resolves the initial atmosphere once, then uses direct pressure/gas-constant mode. Total pressure and gas constant stay fixed. CO₂ partial pressure changes with ppm; specified background gas shares scale in proportion to the remaining non-CO₂ fraction. This makes the search an adjustment of the existing radiative concentration, without silently changing atmospheric mass or the bulk thermodynamic constants. It does not add chemistry or recompute a physically evolving mixture's molecular weight.

`src/model/climate/gcm/targeting/{index.ts,types.ts}` owns the assessment/search and atmosphere updates through `GCM_TARGETING`. `runner/targeting/{index.ts,types.ts}` coordinates both engines using their existing checkpoint lifecycle. The normal fixed-forcing path bypasses this controller.

- CPU: request a clean checkpoint, stop the old session, then start the matching Wasm build with the restart and updated namelists. Native `radini` broadcasts namelist CO₂ and initializes `dqco2`, including after restart. Every worker receives the edited configuration. No Fortran or binary change is needed.
- GPU: drain and checkpoint the queued batches, terminate the old worker, then restore state in a new worker. After restoring the saved buffers, overwrite both `co2` and `dqco2` with the newly configured values. This step is essential: restoring the previous buffers alone would undo the adjustment. The startup schedule is skipped for restarts.

The controller handles Pause/Resume, Clear and an explicit Save while an adjustment is pending. Automatic trial checkpoints are internal and do not download files. Explicit saves include the effective configuration and targeting state. Formats **18 (CPU)** and **19 (GPU)** store the starting/current CO₂, trial boundary, progress and complete adjustment history. The decoder validates targeting data against the effective saved CO₂; older formats are rejected. Loading remains paused and preserves the original baseline for the total ppm difference.

## Verification

Run sequentially with other `/gcm` pages and benchmarks stopped:

```powershell
node scripts/exoplasim-webgpu/verify-targeting.mjs
pnpm lint
pnpm typecheck
pnpm build
```

The verifier covers cold/warm adjustments, logarithmic bracketing, convergence, transient crossings, energy imbalance, temperature drift, previous/partial-year exclusion, zero and bounded CO₂, trial/adjustment limits, missing annual history, invalid saved state, fixed bulk atmosphere properties and temperature-unit conversion.

Browser checks exercise T21 GPU with 5/10 layers and CPU with 10 layers/2 ranks and 5 layers/4 ranks. They seed twenty synthetic settled annual means to trigger a real 300→600 ppm adjustment promptly, then check finite continued fields, paused save/reload, retained search history and a radiative difference against a 300 ppm continuation from the original restart. These seeded histories test controller/engine integration; they are not evidence that the physical model equilibrates in twenty years or reaches an arbitrary goal. Panel checks cover blank/off, input activation, Celsius/Fahrenheit switching and visible progress. Reports and the panel screenshot are in `stats/exoplasim-targeting/`.

The non-app `scripts/exoplasim-wasm/run-browser.mjs` benchmark does not execute the targeting controller or application restart cycle. It is not an acceptance check for this feature. No throughput claim or physically equilibrated targeting measurement is made by the short integration checks.
