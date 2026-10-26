# ExoPlaSim atmosphere configuration

The Atmosphere panel supports two input modes using the existing native `PSURF`, `GASCON`, `CO2` and `NO3` parameters. Gas-mixture calculations mirror the Python wrapper at pinned ExoPlaSim commit `5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff`, `exoplasim/__init__.py`, its `smws` table and `Model.configure()` gas branches. These are parameter preparation, not new radiation or convection physics. For other controls and diagnostics, see [Browser model controls and diagnostics](exoplasim-controls.md).

## Modes and native defaults

**Gas mixture** sums the supplied partial pressures and derives mean molar mass and the specific gas constant. **Pressure + gas constant** uses the specified bulk values for the whole atmosphere; optional partial pressures describe components inside that total. Switching modes retains entries but only the selected mode determines bulk pressure and gas constant.

| Setting | Default |
| --- | --- |
| Input mode | Gas mixture, all gases unspecified |
| Each partial pressure | Unset (`null`), including CO₂ |
| Native total surface pressure | 1.011 bar (101,100 Pa) |
| Native mean molar mass | 28.970253 g/mol |
| Native gas constant | 8314.46261815324 / 28.970253 = 287.0000002469167 J/(kg·K) |
| Native radiative CO₂ | 300 ppm |
| Ozone | Off |
| Direct pressure / gas-constant inputs | Unset; resolve to the native values above |
| Timestep | 45 minutes; choices 5, 10, 15, 30 and 45 |

The pinned wrapper's pressure default is 1.011 bar, rather than the rounded 1 bar sometimes quoted in descriptions. It initializes CO₂ to 300 ppm when no CO₂ partial pressure is supplied; that is not a universal 0.0003 bar partial pressure. At the native pressure, 300 ppm corresponds to 0.0003033 bar. Earth reference partial pressures are help examples and are not silently prefilled as defaults.

This reorganization intentionally replaces the old browser atmosphere preset (N₂ 0.78 bar, O₂ 0.21 bar, Ar 0.01 bar, CO₂ 300 ppm and ozone on). New runs now use the pinned native automatic atmosphere by default. Existing non-atmospheric browser presets are unchanged.

## Mixture calculation

All nine partial pressures are in bars. For supplied pressures `pᵢ` and molar masses `Mᵢ` in g/mol:

- `P = Σpᵢ`.
- `M = Σ(pᵢ × Mᵢ) / P`.
- `R = 8314.46261815324 / M`, in J/(kg·K).
- If CO₂ is supplied, `CO2_ppm = 1,000,000 × pCO2 / P`.

When no positive component pressures are supplied, bulk pressure and gas constant fall back to the native atmosphere. Unspecified CO₂ retains 300 ppm without adding another pressure term or changing the mixture mass, following the wrapper's fallback. An explicit CO₂ partial pressure contributes to bulk pressure and molar mass and sets radiative CO₂. An explicit zero CO₂ sends `CO2=0`, preserving the native Fortran capability and the port's previous zero-CO₂ capability; unlike the Python wrapper's truthiness test, it does not silently fall back to 300 ppm.

## Direct bulk configuration

In direct mode, total pressure and gas constant independently use their input values or native defaults if blank. Optional gas pressures do not recompute these selected bulk quantities. This corresponds to supplying explicit `pressure` and `gascon` overrides to the wrapper, including native-value overrides when the inputs are blank. CO₂ is still divided by the selected total pressure to obtain ppm.

The sum of supplied gas pressures must not exceed the total, allowing a relative numerical tolerance of 10⁻¹² (scaled by at least 1 bar) for floating-point summation. This validation prevents a physically inconsistent atmosphere; it is not a model-tuning constant. The gas constant must describe the entire atmosphere, including any unspecified remainder. A status message reminds users when a partial gas list is supplied while the direct gas constant remains at its native Earth value.

All specified pressures must be finite and nonnegative; bulk pressure and gas constant must be finite and strictly positive. Numeric fields accept trace-gas precision and scientific notation without imposing an arbitrary maximum atmosphere. The panel shows the resolved model pressure, gas constant and radiative CO₂ concentration, or a validation error. Configuration preparation rejects invalid values before starting the model.

## Gases and limitations

The molar masses below come from the pinned wrapper's `smws` table.

| Gas | Molar mass (g/mol) | Meaning and limits |
| --- | --- | --- |
| H₂ | 2.01588 | Bulk pressure/molecular weight. Hydrogen-dominated moist convection is not fully represented. |
| He | 4.002602 | Bulk pressure/molecular weight. Similar light-atmosphere limitations; no new helium radiation scheme. |
| N₂ | 28.0134 | Bulk mixture; Earth reference approximately 0.7809 bar. |
| O₂ | 31.9988 | Bulk mixture; Earth reference approximately 0.2095 bar. Does not automatically enable ozone or oxygen photochemistry. |
| Ar | 39.948 | Bulk mixture; Earth reference approximately 0.0093 bar. |
| Ne | 20.1797 | Bulk mixture, without a neon-specific absorption scheme. |
| Kr | 83.798 | Bulk mixture, without a krypton-specific absorption scheme. |
| CO₂ | 44.01 | Bulk mixture and the model's existing CO₂ greenhouse concentration. At 1 bar, 0.0003 bar gives 300 ppm. |
| H₂O | 18.01528 | Bulk mixture only. Does not initialize humidity, add hydrological water or directly set water-vapor greenhouse absorption; these remain prognostic. |

Ozone uses the prescribed Earth-tuned native layer and affects absorption/heating. It is a separate choice from oxygen abundance and may be inaccurate for different atmospheric compositions or stellar spectra. The model retains broader Earthlike assumptions; selecting a bulk composition does not add missing gas-specific physics.

Below 0.1 bar or above 10 bar, the panel displays the requested pressure-range guidance: native integrations may need much shorter timesteps, potentially 5 minutes. This is a caution range, not a hard model cutoff or a guarantee of stability at 5 minutes. The 45-minute upstream default remains unchanged; smaller choices write the existing `MPSTEP` and corresponding `NSTPW` values.

## Modules, saves and verification

`src/model/climate/gcm/atmosphere/{index.ts,types.ts}` owns preset masses, native defaults, mode resolution and validation through `GCM_ATMOSPHERE`. Both namelist preparation and `GcmAtmosphereControls.tsx` use it, so preview and execution share one calculation. All atmospheric fields are stored together in `GcmConfig.atmosphere`. The shared `LabeledNumberInput` primitive provides precise numeric entry and the existing question-circle help behavior with centralized styling.

Checkpoint format 10 stores mode, all nine nullable pressures, direct bulk inputs and ozone. Older formats are rejected; a fresh run is required. No Fortran, snapshot layout or binary changes are needed for these existing namelist parameters.

With an idle development server at `http://localhost:5174`, run:

```powershell
pnpm lint
pnpm typecheck
node scripts/exoplasim-wasm/verify-atmosphere.mjs
node scripts/exoplasim-wasm/verify-model-options.mjs
```

The atmosphere verifier checks native defaults, all nine pure-gas molecular weights, an Earth reference mixture, direct-mode CO₂ dilution, explicit zero CO₂, invalid inputs, pressure guidance and the absence of a direct radiative change from the H₂O bulk parameter. It performs three sequential T21/10-layer/2-worker runs of at least 48 steps with a 5-minute timestep: native automatic atmosphere; Earth reference mixture; and direct 0.5 bar / 300 J/(kg·K), with ozone and all nine gas entries supplied. All diagnostics must remain finite and checkpoint atmosphere values must round-trip exactly. UI checks cover blank defaults, mode changes and retention, numeric precision, validation, H₂O help, locked inputs and save/clear/load of the entire gas list. Reports and screenshots are in `stats/exoplasim-atmosphere/`.

The broader model-options verifier checks both horizontal resolutions, both layer counts, all worker counts, maps, monthly/annual history and paused restarts using an explicit mixture equivalent to the former 1,000-ppm test atmosphere. These are short functional checks, not equilibrium or exotic-atmosphere accuracy validation.
