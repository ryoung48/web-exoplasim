# Köppen climate maps

Köppen uses the last 12 completed model months. Land uses monthly 2 m air temperature and precipitation. Land follows `Koppen_Alg` in [koppenpasta.py](https://github.com/hersfeldtn/koppenpasta/blob/main/koppenpasta.py) with its default options and `koppen_standard_color` palette, including As: arid is tested before polar, hot/cold arid splits on a coldest month above 0 °C, summer is the warmest six-month window, and a/b require at least four months above 10 °C. Upstream only tries summer windows starting in the first six months, which misplaces southern-hemisphere summers; every start month is tried here. Precipitation stays accumulated over the configured month duration (`yearDays / 12`), as for Pasta, where upstream always uses 30-day months. Oceans use monthly surface temperature and sea-ice cover, following the full, seasonal `Sea_Alg` classification and `sea_standard_color` palette in [koppenpasta.py](https://github.com/hersfeldtn/koppenpasta/blob/main/koppenpasta.py).

| Code | Name | Rule | RGB |
| --- | --- | --- | --- |
| SeaTrop | Tropical sea | Coldest monthly surface temperature above 18 °C, without seasonal ice | 9, 120, 171 |
| SeaTemp | Temperate sea | Other ocean without seasonal ice | 113, 171, 216 |
| SeaSeasonalIce | Seasonal sea ice | Maximum monthly ice cover above 20%, with minimum cover at most 80% | 185, 227, 255 |
| SeaPermIce | Permanent sea ice | Minimum monthly ice cover above 80% | 226, 248, 255 |

Ice classification takes precedence over the temperature classes. Thresholds are strict: exactly 18 °C is temperate, exactly 20% maximum cover is not seasonal ice, and exactly 80% minimum cover is seasonal rather than permanent ice. The browser uses the supplied ice diagnostic, rather than the source's optional temperature proxy or seasonless mode. Its flat-sea option remains the unclassified class-zero fallback and is not a selectable mode.

Both model-grid and downscaled maps classify oceans. Downscaling uses the existing surface-temperature lapse adjustment and sea-ice interpolation. Legends and hover names use the same class definitions as the map colors. Checkpoints retain monthly diagnostics, so loading them recalculates the ocean classes without a format change. These are diagnostic categories; they do not change climate physics.

Run `node scripts/exoplasim-wasm/verify-climate.mjs` with `GCM_TEST_URL` pointing at the local `/gcm` page. Ocean checks cover all four classes, exact threshold boundaries, source RGB values, mixed land/ocean inputs, use of surface rather than air temperature, model/downscaled maps and legend names. The same verifier checks the existing land and Pasta classifications.
