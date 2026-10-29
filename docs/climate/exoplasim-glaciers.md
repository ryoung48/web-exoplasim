# Glacier lifecycle

## Native behavior

At pinned ExoPlaSim commit `5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff`, `exoplasim/plasim/src/glaciermod.f90` defines these operations:

- `glacierini` initializes land persistence flags to true and ocean flags to false. It initializes glaciers from supplied surface data, an explicit initial ice sheet, or snow/ice deeper than 30 m.
- `glacierstep` clears persistence whenever snow depth drops below `GLACELIM` (2 m by default). It removes existing glacier cover below 0.1 m snow depth. Recovered snow depth does not restore persistence within the same session.
- `glacierstop` sets glacier cover to one wherever persistence remains true and writes that state to the restart. It is called by `surfstop` during the native model's shutdown.

Promotion is an end-of-session operation, not a calendar-year callback. The usual Python workflow runs successive one-year model sessions, which makes persistence a yearly test.

## Browser implementation

Both browser engines run one continuous session, so they move promotion to the end of each calendar year, which reproduces the Python wrapper's one-year sessions:

1. Every step on land, snow below `GLACELIM` clears persistence and snow below 0.1 m removes glacier cover, as in `glacierstep`.
2. On the step whose successor starts a new calendar year (by the model calendar, including Gregorian leap years), persistent land becomes glacier. Persistence then resets to true on land (`dls >= 0.5`) and false elsewhere, as `glacierini` sets it.
3. Save no longer promotes. Persistence is stored in the restart, so a run loaded from a mid-year checkpoint continues the same year's test.

GPU: `src/model/climate/gcm/physics/glacier/wgsl/glacierstep.wgsl` implements all three, with the `dpersist` state field and a year-end flag at `SURFACE_STEP + 6` that `STEPPER.values` sets from `CALENDAR.date`. Setup initializes `dpersist` from the land mask; the nkits start-up steps already apply step 1.

CPU: `glacier_years` in `scripts/exoplasim-wasm/model_source.py` patches `glaciermod.f90` during the build. `glacierstep` compares `step2cal`/`step2cal30` of `nstep + 1` with `ndatim`; `glacierstop` writes `persist` to the restart without promoting, and `glacierini` reads it back on restart.

Checkpoint formats moved to 14 (CPU) and 15 (GPU), because earlier files do not contain persistence. Earlier checkpoints are rejected.

## Audit reproduction (before the fix)

The isolated native fixture extracts the actual pinned `glacierstep` and `glacierstop` routines, replacing only file-output calls with stubs. The GPU fixture executes the unmodified `GLACIER.CODE` shader with the same inputs.

| Land case | After timestep routines, both engines | After native shutdown | GPU after the same steps |
| --- | --- | --- | --- |
| Snow remains at 3 m; initially no glacier | No glacier | Glacier | No glacier |
| Snow dips to 1 m, then recovers to 3 m | No glacier | No glacier | No glacier |
| Existing glacier dips below 0.1 m | Removed | Removed | Removed |
| Snow remains exactly at the 2 m threshold | No glacier | Glacier | No glacier |
| Existing glacier remains above 0.1 m | Retained | Retained | Retained |

Commands and reports are local investigation artifacts:

- `wsl -d Ubuntu -- python3 stats/glacier-audit/native.py` → `stats/glacier-audit/native.json`
- `node stats/glacier-audit/gpu.mjs` → `stats/glacier-audit/gpu.json`

These fixtures established the missing state transition. They do not measure climate sensitivity or model throughput.

## Fix verification

- `wsl -d Ubuntu -- python3 stats/glacier-audit/native-promotion.py` compiles the patched `glacierstep` and `glacierstop` with a stub calendar. Mid-year steps leave glacier cover unchanged, the year-end step yields the native after-shutdown result `[1,0,0,0,1,1]`, persistence resets, and `glacierstop` saves persistence without changing cover.
- `node stats/glacier-audit/gpu-promotion.mjs` runs the shader on the same cases and matches.
- `node stats/glacier-audit/gpu-years.mjs stats/exoplasim-reference/inputs/earth-t21` runs the full T21 GPU model over two year boundaries. Persistence resets to all 696 land points at each boundary, and 204-205 points persisted through each year, all already glacier in Earth's surface data, so cover stayed at 205.

## Year-79 checkpoint evidence

The supplied GPU T42/10-layer checkpoint, `exoplasim-t42-layers10-year0079-month08.ckpt`, has zero glacier cover in its restart state and all retained monthly diagnostics. Area-weighted analysis finds 4.87% of land currently has at least 2 m snow-water equivalent, and 4.86% of land has at least 2 m in every retained monthly mean. Antarctic examples have monthly minimum means above 4 m. These are candidate persistent-snow locations, not proof of uninterrupted timestep-level persistence: monthly averages do not retain every snow minimum.

The missing glacier flag affects glacier albedo, soil thermal properties and freezing limits, and vegetation exclusion. Snow retains its own albedo treatment even without a glacier flag. The investigation therefore confirms missing glacier formation but does not establish how much it contributes to the warm equilibrium. A controlled comparison is required before assigning a temperature effect.

Correct behavior needs consistent persistence windows and promotion in both continuous engines, independent of Save frequency. Existing checkpoints do not contain the missing persistence history, so it cannot be inferred exactly from their monthly means.
