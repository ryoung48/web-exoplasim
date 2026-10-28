# Browser model controls and diagnostics

The `/gcm` page exposes the controls below from ExoPlaSim commit `5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff`. For builds and performance history, see [ExoPlaSim WebAssembly](exoplasim-wasm.md) and the [build instructions](../../scripts/exoplasim-wasm/README.md).

## Planet, atmosphere and illumination

Settings apply when starting a new run. A checkpoint restores its saved settings. Radiation is calculated every model step in both engines (`NRADINT = 1`); the page no longer offers a radiation-cadence control.

Each settings input has a question-circle icon explaining its meaning, effect on the simulation and relevant interactions. Help topics include numerics, planet/star/orbit/atmosphere/surface settings and conditional terrain-import controls. Hover, focus with the keyboard, or tap to read; Escape or a click outside dismisses help. Help remains available while a run locks the inputs. Tooltips stay within the viewport and outside the scrolling sidebar's clipping area. Help text is centralized in `src/ui/gcm/input-help.ts`; these descriptions do not change the model configuration or calculations.

| Control | Default | Panel range | Model setting |
| --- | --- | --- | --- |
| Atmosphere | Native automatic atmosphere | Gas mixture or direct pressure/gas constant; nine partial pressures in bars | `PSURF`, `GASCON`, `CO2`, `NO3`; see [Atmosphere configuration](exoplasim-atmosphere.md) |
| Radius | 1 Earth radius | 0.5–2, steps of 0.01 | `PLARAD` in `planet_namelist` |
| Gravity | 9.80665 m/s² | 1–30, steps of 0.01 | `GA` in `planet_namelist` |
| Tidally locked illumination | Off | On/off | `NFIXED` in `radmod_namelist` |
| Substellar longitude | 180° east | 0–360°, steps of 1 | `FIXEDLON` in `plasim_namelist` |
| Ocean mixed-layer depth | 50 m | 1–200 m, steps of 1 | `MLDEPTH` in `oceanmod_namelist` |
| Land albedo override | Unset (native behavior) | 0–1, steps of 0.001 when enabled | `ALBLAND`, `DGROUNDALB`; removes the land-albedo surface map |
| Ocean albedo override | Unset (native behavior) | 0–1, steps of 0.001 when enabled | `ALBSEA`, `DOCEANALB` |
| Snow/ice albedo override | Unset (native behavior) | 0–1, steps of 0.001 when enabled | Upstream `snowicealbedo` namelist mapping |
| Soil water capacity override | Unset (native behavior) | 0.01–2 m, steps of 0.01 m when enabled | `WSMAX`; removes `*0229.sra` |
| Soil heat capacity override | Unset (native behavior) | 0.1–5 MJ/m³/K, steps of 0.1 when enabled | `SOILCAP`, stored in J/m³/K |
| Soil depth multiplier | 1× | 0.1–5×, steps of 0.1 | Scales all five `DSOILZ` entries |
| Longitude of periapse override | Unset; native 102.7° | 0–360°, steps of 0.1° when enabled | `MVELP` in `planet_namelist` |
| Generic Keplerian orbit | Off | On/off | `NGENKEPLERIAN` |
| Initial orbital phase override | Unset; native −2.9589° | −360–360°, steps of 0.0001° when enabled; shown in Keplerian mode | `MEANANOM0` |
| Atmospheric layers | 10 | 5 or 10 | Compiled `NLEV_ATM`; selects the matching model asset |
| Rotation period | 1 day | 0.25–100 days, steps of 0.25 | Existing `ROTSPD` and calendar mapping |
| Year length | 360 Earth days | 60–720 days, steps of 1 | `SIDEREAL_YEAR` and derived `N_DAYS_PER_YEAR`; exactly 365 model days selects the native Gregorian calendar |

The newly added control defaults and radius conversion (6,371,220 m per Earth radius) follow the pinned Python `Model.configure()` implementation and inherited Earth constants. In particular, the wrapper explicitly initializes CO₂ to 300 ppm when no CO₂ partial pressure is supplied. This does not mean every pre-existing browser preset matches upstream: stellar temperature, vegetation, glaciers, fixed orbit and filtering include browser-selected defaults. The slider ranges are interface choices for terrestrial-planet experiments, not claims that every combination is stable or scientifically validated: the radius/gravity ranges cover smaller and larger terrestrial worlds; ocean depths span shallow through deep slab oceans; and the rotation range allows slow rotators. Their increments balance adjustment precision with useful travel on a slider. Substellar longitude covers a complete turn.

Atmosphere now supports the two upstream input patterns: derive total pressure and gas constant from a gas mixture, or set those bulk quantities directly with optional gas partial pressures. H₂, He, N₂, O₂, Ar, Ne, Kr, CO₂ and H₂O are entered in bars. Blank gas fields preserve native defaults; the pinned source uses 1.011 bar, approximately 287 J/(kg·K), 300 ppm CO₂, and ozone off. This intentionally replaces the former prescribed N₂/O₂/Ar mixture and ozone-on browser preset. See [Atmosphere configuration](exoplasim-atmosphere.md) for formulas, exact defaults, gas-specific limitations and verification.

Terrain elevation is converted to geopotential using the selected gravity. Terrain previews use standard Earth gravity; they display elevation and land coverage, which do not depend on this conversion. Climate downscaling retains its empirical Earth-calibrated lapse-rate heuristic; it is a display approximation, particularly for non-Earth planets. Atmospheric-layer temperatures are interpolated without a surface lapse correction.

Tidally locked illumination uses upstream's synchronous-illumination switch. The native fixed-star declination equals the orbital obliquity; generic Keplerian mode also applies its right-ascension correction to the chosen longitude. The rotation period still controls dynamics independently. Fixed orbit is the separate control for freezing orbital parameters; it does not fix the star in the sky. Both engines support these controls; see [GPU input support](exoplasim-webgpu-inputs.md) for the native conventions and parity checks.

The ocean setting controls slab-ocean heat storage, not a dynamic deep ocean. Earth surface climatology is unchecked by default. Enabling it retains the bundled surface boundary data; leaving it off initializes those properties from model defaults.

## Orbital geometry and atmospheric layers

Orbital defaults mirror the pinned wrapper's `lonvernaleq=None`, `keplerian=False` and `meananomaly0=None`. The browser writes `NGENKEPLERIAN=0` by default and omits `MVELP` and `MEANANOM0`, preserving the native `p_earth.f90` values 102.7° and −2.9589°. Enabling either override starts from that native value. Angular bounds cover a full turn; periapse uses nonnegative longitude, while mean anomaly accepts signed angles so the exact native phase can be displayed. The phase slider's 0.0001° step retains the native −2.9589° value without rounding it on activation. Input validation rejects nonfinite/out-of-range angles and unsupported layer counts.

Periapse longitude is measured from the northern autumnal equinox, not a surface meridian. It changes how orbital distance aligns with seasons: 0° places periapsis at northern autumn equinox, 90° at winter solstice, 180° at spring equinox and 270° at summer solstice. To convert from the argument of obliquity, subtract 90° and add 360° if negative. Initial orbital phase is mean anomaly, which advances uniformly in time and differs from geometric true anomaly for eccentric orbits. It is effective only in generic Keplerian mode. Turning that mode off hides the phase control while retaining the selected value for later use. The generic scheme does not calculate Earth's precession/Milankovich cycles. Fixed orbit and fixed stellar illumination retain their separate native settings. The existing eccentricity slider remains 0–0.3; this change does not expand its range. The wrapper's configure branch and the actual Fortran namelist spell the phase parameter `MEANANOM0`; a differently spelled key in upstream's separate modify branch is not used.

Atmospheric layer count is compiled into ExoPlaSim, not a runtime namelist. Numerics selects 5 or 10, with the upstream `Model(layers=10)` default retained. Each T21/T42 and worker-count combination has a separate compiled asset for each count. Both use the native `NEQSIG=0` grid. Five layers also write `NSELA=0`, as required by the native `tracermod.f90` FFSL initializer, which rejects fewer than six layers. Native spectral humidity transport (`NQSPEC=1`) remains the active scheme; the unsupported unused FFSL initializer is skipped. Ten-layer settings are unchanged; maps, relative humidity, jet selection and sea-level pressure follow the actual model layers. Five layers reduce vertical resolution and per-step work but change the physical discretization; they are not a display optimization or a guarantee of equivalent climate accuracy. Speed improvements require measurement and need not scale linearly with layer count.

The layer selector shows 1 through the active count, labels the actual bottom layer, and clamps a previously selected higher level when switching to 5. A run and its monthly/annual snapshots carry their layer count explicitly; relative humidity uses the actual lowest layer. Saves select the matching horizontal resolution and vertical count on load. Diagnostics with mismatched layer/resolution metadata are rejected before loading the native restart. Changing resolution or layer count applies to a new run; an existing checkpoint retains its saved count.

## Albedo defaults and overrides

All three new albedo controls start at `null`, matching `Model.configure(soilalbedo=None, oceanalbedo=None, snowicealbedo=None)` in the pinned upstream `exoplasim/__init__.py`. The panel displays “ExoPlaSim default” and writes no albedo namelist entries until an override is enabled. This preserves upstream surface maps, spectral bands and temperature-dependent behavior; the effective default is not a single constant. Turning an override off restores this behavior on the next new run.

Enabling an override offers a starting value from the upstream scalar declarations: land 0.22 (`landmod.f90`), ocean 0.069 and ice 0.7 (`seamod.f90`). These are explicit override starting points, not claims about spatially varying native reflectivity. Sliders cover the physical reflectivity interval 0–1 in 0.001 increments (0.1 percentage points), with finite-value validation and zero supported.

The namelist mapping follows the pinned Python wrapper's albedo branches: land sets `ALBLAND` and both `DGROUNDALB` bands and removes `*0174.sra`; ocean sets `ALBSEA` and both `DOCEANALB` bands; snow/ice sets `ALBICE`, both `DICEALBMN` and `DICEALBMX` bands, and land's `DSNOWALBMN`, `DGLACALBMN`, `DSNOWALB` bands. Upstream repeats its `DSNOWALBMN` write and does not change `DSNOWALBMX`; the port follows that behavior. These settings do not disable vegetation, snow-cover blending or other native surface-state logic, so an override need not make the effective albedo map uniformly equal to its slider value.

## Soil defaults and overrides

The soil controls mirror `Model.configure(soilwatercap=None, cpsoil=None, soildepth=1.0)`. Water and heat capacity remain unset by default, preserving native declarations and surface data. Enabling an override starts from the upstream Earth declarations in `landmod.f90`: 0.5 m water capacity and 2.4 × 10⁶ J/m³/K soil heat capacity. Override starting points do not imply that the effective native state is spatially uniform. Water capacity is displayed through the shared precipitation-depth formatter (mm or inches); heat capacity is shown in MJ/m³/K and stored in J/m³/K.

An explicit water-capacity override writes `WSMAX` and removes `*0229.sra`, matching the Python wrapper, while retaining unrelated surface files. This selects capacity, not initial soil saturation. Soil heat capacity writes `SOILCAP`; glaciers retain their separate ice properties. Soil depth writes `DSOILZ` as the native layer thicknesses `[0.4, 0.8, 1.6, 3.2, 6.4]` m multiplied by the selected scale. At 1×, total soil depth is 12.4 m. Depth and volumetric heat capacity change ground heat storage; the independent water-capacity input controls hydrological storage.

All three soil values must be finite and strictly positive when specified. The panel ranges are experiment-oriented interface limits, not model stability guarantees: water capacity covers shallow through large stores around the native 0.5 m; heat capacity spans values around the native 2.4 MJ/m³/K; depth spans one tenth through five times the native profile. Steps provide 10 mm water-capacity adjustment, 0.1 MJ/m³/K heat-capacity adjustment and 10% depth adjustment. The default nullable controls follow upstream's unset branches; zero, which the wrapper would silently ignore for capacity overrides, is rejected explicitly.

Albedo and soil overrides reuse the same settings component, `src/ui/gcm/GcmOverrideControls.tsx`, rather than duplicating the default/override interaction.

## Map fields

The snapshot hook publishes 40 non-layer fields plus five fields per atmospheric layer: 90 fields at 10 layers or 65 at 5. These include the original 18; evaporation, runoff, forest cover and leaf area index; snowfall, snowmelt, sea-ice thickness and glacier cover; sea-level pressure; four surface energy components; convective and large-scale precipitation; net TOA shortwave and longwave; then temperature, eastward wind, northward wind, relative humidity and cloud cover at each actual model layer. The snapshot order is defined by `scripts/exoplasim-wasm/gcm_publish.f90` and `src/model/climate/gcm/fields/index.ts`. Workers reject a mismatched field count, rather than silently interpreting an older model's arrays.

| Map | Definition and units | Color range |
| --- | --- | --- |
| Convective precipitation | Existing `dprc`, converted to mm per 24-hour day | 0–20 |
| Large-scale precipitation | Existing `dprl`, converted to mm per 24-hour day | 0–20 |
| TOA net shortwave | `dswfl(:,1)`, incoming minus reflected sunlight, positive downward, W/m² | 0–1,400 |
| TOA net longwave | `dlwfl(:,1)`, positive downward (normally negative for outgoing thermal radiation), W/m² | −400 to 0 |
| TOA net radiation | Net shortwave plus net longwave at the atmosphere's top; positive downward, W/m² | −1,000 to +1,000 |
| Surface net heat | Radiation plus sensible/latent heat and snowmelt energy, as already used by convergence; positive into the surface, W/m² | −1,000 to +1,000 |
| Net surface solar | `dswfl(:,NLEP)`, net shortwave into the surface, W/m² | 0 to 1,000 |
| Net surface thermal | `dlwfl(:,NLEP)`, net longwave into the surface, W/m² | −300 to +300 |
| Sensible heat | `dshfl`, positive into the surface and negative for surface heat loss, W/m² | −300 to +300 |
| Latent heat | `dlhfl`, positive into the surface and negative for surface heat loss, W/m² | −500 to +500 |
| Relative humidity | Specific humidity divided by saturation specific humidity in the lowest atmospheric layer, % | 0–100 |
| Evaporation | Negative of Fortran's `devap`, converted to mm per 24-hour day; positive for evaporation, negative for condensation | −15 to +15 |
| Runoff | `drunoff`, converted to mm per 24-hour day | 0–15 |
| Forest cover | Surface forest fraction `dforest`, % | 0–100 |
| Leaf area | SimBA leaf area index `dlai`, dimensionless | 0–10 |
| DTR | Daily maximum minus minimum 2 m air temperature, °C difference | 0–30 |
| Atmospheric temperature | Air temperature on the selected model layer, °C | −90 to +40 |
| Atmospheric wind | Magnitude of the selected layer's vector wind, m/s, with arrows | 0–60 |
| Atmospheric humidity | Relative humidity on the selected model layer, % | 0–100 |
| Atmospheric cloud cover | Existing `dcc` cloud fraction on the selected model layer, % | 0–100 |
| Sea-level pressure | ExoPlaSim `pyburn` sea-level reduction of surface pressure, hPa | 960–1,040 |
| Snowfall | `dprs`, liquid-water-equivalent depth in mm per 24-hour day | 0–20 |
| Snowmelt | `dsmelt`, liquid-water-equivalent depth in mm per 24-hour day; positive for melting | 0–20 |
| Sea-ice thickness | `diced`, physical ice thickness converted from meters to mm (inches in imperial) | 0–3,000 mm (0–3 m) |
| Glacier cover | `dglac`, the model's land glacier mask converted to % | 0–100 |

Water cycle adds Convective and Large-scale alongside total Precipitation, Evaporation and Runoff. Both components retain the precipitation palette, units and 0–20 mm/day color range. Radiation adds TOA solar and TOA thermal. The shortwave scale spans ordinary Earth-like incoming sunlight; the longwave scale emphasizes outgoing thermal flux magnitudes. The total precipitation and TOA net radiation maps remain the native component sums (apart from Float32 display rounding). TOA thermal retains the native downward-positive sign, whereas the existing Outgoing IR map reverses that sign for positive outward flux. All four additions read existing arrays and do not add physics.

Surface energy groups Net heat, Solar, Thermal, Sensible and Latent. All use the native sign convention, positive into the surface. Net heat also includes the existing snowmelt-energy term, so it need not equal the four displayed components alone. These maps publish existing model arrays without adding an energy-flux estimate. Their display ranges emphasize common terrestrial magnitudes; symmetric ranges distinguish gain from loss.

These are fixed display ranges chosen for legible terrestrial-climate maps. Humidity and cover use their natural fraction ranges; symmetric energy and evaporation scales center zero; the atmospheric temperature range includes the cold upper atmosphere; runoff, wind and leaf-area ranges emphasize ordinary spatial differences. Values outside color ranges remain available in hover readouts, without clipping the diagnostics themselves. The palette does not imply an acceptance threshold.

Relative humidity reuses `pumamod`'s thermodynamic constants and the saturation relation used by `rainmod.f90`'s `mkclouds`, evaluated at the snapshot's temperature and pressure. It is computed at publication time. This is lowest-layer humidity, not a reconstructed 2 m humidity diagnostic. The previous “surface wind” label now says “lowest layer” for the same reason. The precipitation map remains the sum of convective and large-scale precipitation, and is labeled precipitation rather than rain.

Temperature also includes DTR. The hook tracks actual 2 m air temperature at every timestep and forms a range over each complete native rotation day (`ntspd` timesteps), independently of the 360-day display calendar. With the default rotation this is approximately a 24-hour day; changing rotation changes this diagnostic window. Publication carries the latest daily range plus the sum and count of days completed since the previous publication. Now uses their mean when any days completed and otherwise holds the last completed value. Monthly values divide accumulated daily ranges by their completed-day count; annual values average the twelve monthly DTR means. Daily completions are assigned to the month of their publication, following the existing snapshot-based monthly accumulation. This avoids treating seasonal changes as a daily range. Before the first complete day the diagnostic is zero. Native daily buffers restart on load, so a partial first day is excluded; saved completed-month values remain available. Downscaling interpolates the range without a lapse offset, since a common offset cancels in maximum minus minimum. The sequential 0–30 °C palette emphasizes terrestrial ranges while hover preserves larger values. Imperial readouts multiply differences by 9/5 without adding 32.

Temperature, Wind, Moisture and Clouds each include an Atmosphere view with a layer selector. Layer 1 is highest; layer 5 or 10 is lowest according to the selected count. These are terrain-following sigma layers, not constant altitudes or fixed pressure surfaces. Their physical pressure depends on local surface pressure. The jet map retains the existing layer nearest sigma 0.25.

Forest cover is the surface fraction used by the model: coupled vegetation updates it; diagnostic vegetation leaves the surface fraction prescribed while computing leaf area and other vegetation diagnostics. Vegetation disabled produces zero diagnostic leaf area. These maps are vegetation diagnostics, not biome classifications.

Ice & snow groups Sea ice, Ice thickness, Snowpack, Snowfall, Snowmelt and Glaciers. Snowfall and melt are water-equivalent rates, not the physical depth of fresh snow; the existing snowpack is also water equivalent. Sea-ice thickness is physical depth and is distinct from ice-covered area. Glacier cover is a mask, not glacier thickness: a monthly or annual fractional value can reflect how frequently the cell was glaciated. Glacier physics remains controlled by the existing Glaciers setting. These four maps expose existing state without changing model physics or its parameters. Snowfall and melt reuse the precipitation rate range (0–20 mm/day); the 3 m ice scale emphasizes thin and seasonal sea ice, and glacier cover uses its natural fraction range. Values outside these display ranges are preserved in hover and averages.

Pressure offers Surface and Sea level; Clouds offers Total cover and Atmosphere. Layer cloud cover is distinct from the total-column cloud fraction: the individual layers are not summed. Sea-level pressure is calculated at publication time using the pinned `pyburn.py` sea-level-pressure branch: the lowest model-layer temperature, full-level sigma, local surface pressure, model gas constant and gravity, and model surface geopotential `doro`. This includes upstream's 0.0065 K/m lapse rate, the 255 K cold-temperature adjustment, its third-order pressure reduction, and its near-zero tolerances (10⁻⁴ m²/s² geopotential and 10⁻⁶ K temperature difference). These parameters mirror upstream, rather than introducing a new reduction scheme. The map uses the same fixed Earth-centered pressure color range as the surface-pressure map; hover retains values outside it.

The pinned version's output catalogue names 10 m wind components (165/166), but its Fortran output routines and both postprocessors do not implement them. Accordingly this port does not expose a 10 m wind map or add a wind extrapolation. Lowest-layer and jet winds remain the existing model fields.

All new maps support live, monthly and annual views, hover, and interpolated display grids. Monthly humidity is the mean of published relative humidities, rather than humidity recomputed from averaged temperature. Wind averages use averaged components, so their speed is the magnitude of the mean vector.


## Climate classifications

Climate groups Köppen and Pasta child modes. Both classify the last 12 completed months and support model-grid/downscaled maps, legends and hover names. See [Pasta climate maps and logic audit](pasta.md) for input equations, exact palette provenance, verification, and remaining differences from the article.

## Save format and verification

Checkpoint format 12 stores the expanded snapshots, interval/monthly temperature extrema and the new settings, along with terrain, unfinished monthly accumulation, completed monthly means and the Fortran restart. Older formats, including format 9's flat atmosphere settings, are rejected because their configuration or field layout differs. Loading remains paused until Resume.

Rebuild all variants without `--link-only` after changing the hook:

```powershell
pnpm build:gcm-wasm
pnpm lint
pnpm typecheck
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/verify-weather.py
$env:GCM_TEST_URL = 'http://localhost:5174'
node scripts/exoplasim-wasm/verify-model-options.mjs
node scripts/exoplasim-wasm/verify-atmosphere.mjs
```

The verifier additionally checks default orbital omission, exact orbital namelist keys, explicit Keplerian runs, layer selection and field counts, layer-aware checkpoint rejection, native soil defaults, five-layer scaling, capacity override mapping and validation, targeted soil-water-file removal, precipitation and TOA component sums, and soil-control save/load.

The verifier requires a development server at `GCM_TEST_URL` and installed Chrome. Keep other `/gcm` runs and benchmark processes stopped. It checks default albedo omission, exact upstream override mappings including zero, invalid-value rejection, targeted surface-file removal, albedo checkpoint retention, pressure/composition, planet dimensions, illumination and ocean namelists, gravity-aware terrain, field conversions and palettes, monthly/annual history, and checkpoint round trips. It then runs T21/T42 at both 5 and 10 layers and 2/4/8 ranks sequentially for at least 48 steps at 30 minutes, using CO₂ 1,000 ppm, radius 1.2 Earth radii, gravity 12 m/s², fixed illumination at 90° east for 2/4 ranks, and ocean depth 20 m. The 8-rank cases instead use generic Keplerian mode, periapse longitude 45°, initial mean anomaly 90°, and ordinary rotating illumination to exercise the orbital calculation. The rank variants cover vegetation off, diagnostic and coupled respectively; the 8-rank cases also set explicit land/ocean/snow-ice overrides of 0.31/0.07/0.65 and soil water capacity 0.25 m, heat capacity 3 MJ/m³/K and depth multiplier 2×. Each case checks finite diagnostics and paused restart. Reports and a UI screenshot are written to gitignored `stats/exoplasim-model-options/`.

`verify-weather.py` compiles the actual snapshot hook with controlled native Fortran fixtures. It checks flat, elevated and below-sea-level cells, upstream's cold-temperature branch, all actual cloud slots, and the four surface energy slots with signed fixtures whose sum must match net surface heat when snowmelt is zero. It also checks the separate precipitation and TOA radiation slots and their sums against the existing total fields. Its independent pressure reference is the exact hydrostatic integral with the same lapse rate and temperature adjustment; the upstream polynomial approximation must stay within 1 Pa for these fixtures. This is a deliberately looser bound than the observed 0.054 Pa maximum, to check signs, units and calculation structure without demanding that a polynomial approximation equal the exact integral. The report is `stats/exoplasim-model-options/weather-formulas-layers-10.json` and `stats/exoplasim-model-options/weather-formulas-layers-5.json`.

These are short functional checks, not equilibrium or long-term stability validation. Their elapsed times include startup, field transfer and checkpoint shutdown and are not directly comparable with the non-app `run-browser.mjs` throughput benchmark.
