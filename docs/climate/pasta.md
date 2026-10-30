# Pasta climate maps

The Climate map group contains Köppen and Pasta child modes. Both use the last 12 completed model months and support model-grid and terrain-downscaled maps, class legends, and class names on hover. Climate stays unavailable until those months exist. Selecting Now or Monthly returns to the temperature map.

Köppen includes four temperature/sea-ice ocean classes; see [Köppen climate maps](koppen.md) for their rules and palette.

Pasta implements the 95 land and nine ocean zones in the [Pasta Bioclimate System](https://worldbuildingpasta.blogspot.com/2025/03/beyond-koppen-geiger-climate.html), including pluvial, dark, hot, and extraseasonal zones. Class zero remains the shared unclassified ocean sentinel; Pasta classifies oceans into its nine explicit zones. Every named zone uses the exact RGB triplet from the supplied chaos-machine Pasta palette. The 104 named colors are checked independently against that source by zone code; class zero uses the reference's dark-ocean fallback [0.05, 0.08, 0.18]. The current upstream Python palette differs from this requested reference in some entries, so palette parity refers specifically to the supplied folder.

The snapshot hook records actual 2 m air temperature minima and maxima at every model timestep, including steps between publications. Each publication carries its interval's extrema; the monthly accumulator retains their minima/maxima rather than averaging them. Thus Pasta's cold/heat limits do not infer extremes from monthly mean temperatures. Because these are absolute timestep extrema, thresholds use the article's absolute tolerances: 0, −15 and −60 °C for winter; 50/70 °C for hot/torrid summers, with pressure-dependent boiling. The article's warmer ExoPlaSim winter thresholds (10, −10, −40 °C) calibrate averaged short-period minima and are not used for these absolute measurements. Temperatures are already measured at 2 m, so no surface-to-air offset is needed. Downscaling applies the existing local lapse correction to means and extrema before classification.

Growing conditions use monthly mean air temperatures and incoming surface sunlight reconstructed from net shortwave and albedo. The article's growing-degree curves use a 5 °C base, a 20 degree-day/day cap, declining above 40 °C to zero at 50 °C; the zero-base curve declines above 40 °C to zero at 60 °C. Light limits growth above 20 W/m² (zero-base growth above 0 W/m²), at one degree-day/day per 10 W/m². Continuous seasons wrap across December/January; regular growth resets at a zero-growth month only when its entire contiguous GInt period exceeds 1,250 units, including neighboring months that still accumulate some growth. Vegetation boundaries use 350/1,300 growing degree-days and 50 zero-base degree-days.

Water availability now uses the script's ASCE-style PET equations with monthly mean air temperature, net surface shortwave plus longwave, surface pressure, lowest-layer relative humidity and wind, forest cover, and the configured atmospheric gas constant. Saturation vapor pressure uses the script's mean-temperature fallback: the absolute timestep extrema are not substituted for daily mean minima/maxima. No deep soil temperature is published, so soil heat flux uses the supported zero fallback. Lowest-layer humidity and wind are proxies for near-surface measurements; the snapshot does not provide 2 m humidity or 2 m wind.

AET uses the model's published net evaporation, clamped to nonnegative values. As in upstream `Biome_Data`, PET is raised to at least AET in every month before the aridity ratios are computed. For downscaled land over a predominantly ocean source cell, the soil-water estimator uses the locally calculated PET and precipitation: 500 mm storage, reduced extraction below 250 mm, endpoint convergence within 10 mm, and a 100-cycle numerical cap. The pure classifier also supports the 7 mm per positive °C per 30-day fallback when no hydrology input is supplied; the browser integration supplies ASCE PET.

Sampling duration is configured yearDays / 12, in 24-hour Earth days. This scales GDD, GDDz, GInt, ocean growing light, precipitation totals and evaporation totals consistently. ASCE daily PET is multiplied by the same duration. Ratios remain dimensionless. Both Köppen and Pasta now receive precipitation accumulated over the configured month duration. The rotation-dependent namelist mapping also uses the selected year length instead of the previous hardcoded 360-day value. The native calendar still quantizes rotation-day counts and calendar timesteps, so yearDays / 12 is the nominal physical sampling duration rather than a measurement from successive snapshots.

Aridity thresholds remain 0.06/0.2/0.75/0.9; growing-season aridity uses 0.5. Growth supply uses the ExoPlaSim threshold 0.8; pluvial evaporation ratios use 0.45, or 0.4 for tropical rainforest.

Ocean temperature zones use monthly surface temperatures with 18/40/60 °C boundaries. Sea-ice zones use 20% seasonal and 80% permanent cover; ocean growth light is counted independently from temperature and ice cover, matching the author’s ocean algorithm. For downscaled waterways, 1 cm of snow supplies a 10% sea-ice proxy. Land ice requires persistent snow above 10 cm at model resolution. Downscaling adjusts ice with temperature: snow above 10 cm in any month becomes permanent ice if the actual 2 m maximum never exceeds freezing, while above-freezing maxima remove interpolated ice. Boiling uses the script's two-piece Antoine equation, comparing each month's maximum temperature with that month's mean surface pressure. Boiling also triggers the hot/torrid tests, allowing low-pressure locations to skip directly into boiling categories. Pressure is interpolated for downscaling without an additional hydrostatic elevation correction.

Verification: run `node scripts/exoplasim-wasm/verify-climate.mjs` with `GCM_TEST_URL` set to the local `/gcm` URL. It checks 46 representative climates and their calendar rotations, 2,000 seasonal fixtures, monthly extrema preservation, both classification/downscaling paths, a full 720 × 360 display raster, hover names, and the Climate/Köppen/Pasta controls with synthetic annual data. Run `wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-weather.py` for native hook checks, including extrema on unpublished steps and reset after publication.

## Logic audit

Audit date: 2026-10-26. Sources are the [article](https://worldbuildingpasta.blogspot.com/2025/03/beyond-koppen-geiger-climate.html) and the author's [koppenpasta 2.2.0 implementation](https://github.com/hersfeldtn/koppenpasta/blob/main/koppenpasta.py), particularly Calc_GDD_total, Biome_Param, Pasta_Alg, and Pasta_Sea_Param/Alg. The article's original GDDz prose retains older 35/55 °C values; its update note and current implementation use 40/60 °C, which this port follows.

This is **not complete parity with the default ExoPlaSim processing recipe**. Core zone rules are audited below, but the selected fallback inputs and unported processing options materially affect results.

| Article concern | Current implementation and audit result |
| --- | --- |
| Zone inventory | All 95 land and nine ocean codes exist, plus the shared ocean sentinel. |
| Minimum temperature | Actual timestep 2 m minima are preserved. Uses the article's absolute physiological thresholds 0/−15/−60 °C, rather than the default ExoPlaSim averaged-extrema tuning 10/−10/−40 °C. This is an explicit interpretation of the input, not default-script parity. |
| Maximum temperature | Actual timestep 2 m maxima; hot/torrid limits 50/70 °C and pressure-dependent Antoine boiling from the author's two coefficient ranges (split at 108.3 °C). A boiling month also satisfies hot/torrid tests. Uses monthly mean pressure with the month's actual maximum, matching the script's pairing. |
| GDD / GDDz | Bases 5/0 °C; plateaus at 25/20 °C; 20 units/day cap; decline over 40–50/40–60 °C. Matches the updated equations. |
| Light limitation | Minimum of temperature and light growth, with 20/0 W/m² baselines and 10 W/m² per growth unit. Incoming light is reconstructed from net shortwave and albedo, capped against a zero absorption denominator; this is an input approximation. |
| PAR and productivity | Fixed Sun-like PAR convention and productivity multiplier 1. User-configurable spectral PAR and productivity modifiers are not implemented. |
| GInt | Positive shortfall of GDDz from 15 units/day; longest contiguous period, with effectively infinite interruption if it persists year-round. |
| Regular growing season | Cyclic longest accumulated growth; a zero-growth month interrupts only if its complete contiguous GInt period exceeds 1,250. Corrected the previous code, which discarded GInt from months with positive regular growth. |
| GDDz and ocean light continuity | Stop at every zero-growth sample; positive growth throughout the cycle counts as infinite. Ocean light uses light alone, without an added ice mask or temperature gate. |
| Calendar duration | Configured yearDays / 12 Earth days. Scales all accumulated growth and water totals, and fixes the rotation-dependent namelist's hardcoded year length. Native calendar/timestep quantization can make actual output intervals differ from this nominal duration. |
| PET | Browser integration uses the author's ASCE-style equations, including gas-constant-dependent psychrometric constant and forest-dependent reference vegetation. Mean-temperature saturation and zero soil heat flux are supported fallbacks; wind/humidity use lowest-layer proxies. Pure-classifier fallback remains 7 mm per positive °C per 30 days, scaled to the month duration. Hargreaves is not exposed. |
| AET | Native model evaporation for land, excluding negative net condensation. Downscaled land over source-ocean cells uses the repeated soil bucket with local PET; 500 mm capacity, stress below 250 mm, endpoint convergence within 10 mm and a 100-cycle cap. |
| Ar / GAr | Annual AET/PET and light-limited-growth-weighted AET/PET; arid below 0.2, hyperarid below 0.06, semiarid below 0.5 GAr, forest/rainforest at 0.75/0.9 Ar. |
| GrS / Evr | Growth-weighted precipitation divided by mean AET; ExoPlaSim GrS threshold 0.8. Annual AET/precipitation defines pluvial below 0.45, except TUrp below 0.4. Does not copy the supplied reference's alternate 0.9 GrS or precipitation/PET pluvial tests. |
| Zone precedence | Ice and barren exclusions before arid; marginal before moist/semiarid, with the author's peritropical exemption; Mediterranean before forest subgroups. Tropical, cold, hot and extraseasonal subtype rules follow the article under the chosen temperature tuning. |
| Boreal / tundra | Boreal through 1,300 GDD; marginal below 350 GDD and barren below 50 GDDz. Corrected the exact 1,300 boundary to match the author's algorithm. |
| Ocean temperature | Monthly surface temperatures; tropical above 18 °C, hot above 40 °C, torrid above 60 °C. These intentionally differ from the supplied reference's 10/50/70 limits. |
| Ocean ice | Seasonal above 20% maximum cover and permanent above 80% minimum cover; permanent ice precedes darkness, seasonal darkness gives Ofg, ice-free darkness gives Og. Exact-boundary cases are checked. |
| Downscaled waterways | Adds the article's snow proxy, 1 cm snow = 10% sea-ice cover. The separate coastal-neighbor “dummy ice” preprocessing option is not ported. |
| Land ice | Persistent snow above 10 cm. Downscaling removes ice above freezing and adds ice where seasonal snow exceeds 10 cm and maximum is below freezing. Uses actual 2 m maxima here; the article instead uses unadjusted surface extrema for this step. Surface extrema are not published, so this remains an approximation. |
| Input/output variants | Rolling 12 completed months with all zones and pluvials enabled. Multi-file averaging/parameter averaging, seasonless processing, alternate reduced zone sets, palette variants and configurable algorithm overrides from the standalone tool are not exposed. |

## Differences from the supplied reference

The palette source is `C:/Users/rayou/projects/nexus/chaos-machine/src/model/climate/classification/pasta/index.ts`. Its classifier is not an exact article oracle: it uses −35 °C for frigid winters, 0.9 GrS, precipitation/PET-based pluvial detection, an extra rainforest precipitation/PET condition, 10/50/70 °C ocean thresholds, temperature-limited ocean growth and a different light conversion. These logic choices were not copied into this port. The requested palette was copied exactly, independently of those choices.

## Reproduce the palette comparison

With a local dev server running, pass its complete /gcm URL in GCM_TEST_URL and the reference source as the first argument:

`node scripts/exoplasim-wasm/verify-climate.mjs C:/Users/rayou/projects/nexus/chaos-machine/src/model/climate/classification/pasta/index.ts`

The palette test extracts the reference RGB table independently and compares each normalized channel exactly. Without the optional path the climate checks still run, but the external palette comparison is skipped. The report records how many colors were checked. This verifies the supplied snapshot, not future edits to that separate repository.


## Upstream equation verification and review notes

The default browser integration now takes ASCE-style PET, native land evaporation, the estimated evaporation fallback for new downscaled islands, and pressure-dependent boiling from the script. The existing cyclic GDD/GInt and ocean zone logic remain aligned with the earlier audit. Absolute 2 m extrema and the requested palette remain the chosen inputs rather than switching to the script's averaged-extrema thresholds or its current palette.

To test the actual Python equations without importing its netCDF/UI pipeline, download the linked script to stats/pasta/koppenpasta.py, then run:

`python scripts/exoplasim-wasm/pasta-upstream-fixtures.py stats/pasta/koppenpasta.py stats/pasta/upstream-formulas.json`

The fixture generator executes only the source's Calc_PET and Estimate_evap functions with NumPy, records the source SHA-256, and produces 64 deterministic cases spanning temperature, radiation, humidity, pressure, wind, forest fraction, gas constant and month duration. Expected values from the source's 30-day outputs are rescaled by monthDays / 30. Supply the generated JSON as the second positional argument to verify-climate.mjs, after the palette reference path, to compare the TypeScript implementation with those values. Reports record the number of upstream cases checked; a run without the JSON skips that comparison.

Review also identified upstream code that should not be copied blindly: the missing-temperature fallback writes maxt + mint / 2 rather than their arithmetic mean, the soil-heat expression subtracts the same rolled array from itself, and Estimate_evap retains a NumPy view of the initial soil store that is overwritten before the convergence comparison. This port supplies actual mean temperatures, explicitly selects zero soil heat flux when unavailable, and retains a scalar copy of initial storage for convergence. The source's absolute-temperature classification and empirical PET equations still have the input limitations stated above.

The soil regression uses eleven dry months followed by 1,000 mm of rain, with PET of 10 mm in every month. Upstream returns zero evaporation in the first eleven months because its initial storage view is overwritten. The converged scalar implementation carries water across the year boundary and supplies 10 mm in every month. The checked source SHA-256 is b22c8da54ac79f3280440246f33177e99313f82dae909e5a22177854ae8c6aa9.
