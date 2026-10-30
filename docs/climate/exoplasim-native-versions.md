# Native ExoPlaSim version comparisons

## ExoPlaSim 3.2.4 at T21 (2026-10-29)

This comparison asks whether the published 3.2.4 release warms under the saved page inputs used by the original native reference. It does not test the Python `Earthlike` defaults or isolate individual physics changes between versions.

### Source and build

The source is the [official PyPI 3.2.4 source distribution](https://pypi.org/project/exoplasim/3.2.4/#files), released on 2023-07-01. Its SHA256 is `09b8f2a6bd0f3a098b21e19b9ed124a683f4dfff62ad685f0a629fc033ea9b12`, verified against the downloaded archive. Source, release metadata, build script, build log and patch are saved under `stats/exoplasim-reference/version-3.2.4/`.

The build uses GNU Fortran 11.4.0, OpenMPI, T21 (64 × 32), 10 atmospheric layers and 8 ranks. Flags match the reference: `-cpp -O2 -march=x86-64 -fallow-argument-mismatch -w -fdefault-real-8 -fdefault-double-8`.

Changes to the release Fortran are limited to supplying the missing timestep argument at the two `calini` call sites, as in the pinned baseline's interface repair, and inserting the existing `gcm_reference.f90` diagnostic hook. There are no radiation-cache, glacier or other physics patches. `instrumentation.patch` records the complete source changes. The isolated executable is `/var/tmp/chaos-exoplasim-3.2.4-t21-r8-p8/exoplasim` in WSL.

### Inputs and interpretation

Inputs are copied from `stats/exoplasim-reference/inputs/earth-t21/`. All 15 `.sra` surface files are byte-identical. Of 32 input files, 30 are byte-identical; the other two only remove unsupported `L_AERO = 0` and `NRADINT = 1` entries. Release 3.2.4 has no aerosol switch in the atmospheric namelist and computes radiation every step without an interval switch. `input-comparison.json` records every input checksum and both text diffs. The runner changes only duration and diagnostic frequency, as for the baseline.

The actual namelists specify 1367 W/m², 5780 K stellar temperature, a circular orbit, 23.5° obliquity, a 360-day year, 45-minute steps, ozone on, 300 ppm CO₂, `NEQSIG = 0`, vegetation mode 2 and glaciers on. In particular, **`landmod_namelist` specifies `NWETSOIL = 0`**, although the adjacent `config.json` says `wetSoil: true`. The comparison follows the actual Fortran input.

Release 3.2.4 also contains a filter broadcast typo: `plasim.f90` broadcasts `npsvfilter`, but the inverse filter uses `nspvfilter`. The namelist requests `NSPVFILTER = 1`; only the root receives that value, while other ranks retain their default 0. This comparison preserves that release behavior. The pinned source fixes the typo. Therefore identical requested settings do not guarantee identical filter behavior across ranks, and this experiment cannot attribute a climate difference solely to radiation or other physical parameterizations. The complete release-to-pinned Fortran diff is `source-differences.patch` in the comparison directory.

### Results

The run was stopped at the user's request after 11 complete simulated years. All 11 annual records contain 11,520 samples and finite values. The saved `run.json` retains the requested 15-year duration and the nonzero exit status from that intentional interruption; this is not a completed 15-year experiment.

| Simulated year | Pinned source global Ts (°C) | 3.2.4 global Ts (°C) |
| --- | --- | --- |
| 1 | 14.72 | 14.90 |
| 5 | 18.08 | 18.05 |
| 10 | 19.83 | 19.58 |
| 11 | 19.93 | 19.83 |

In year 11, release 3.2.4's equatorial surface mean is 32.75 °C, global sea-ice fraction is 0.02405 and net TOA is +0.346 W/m². These measurements establish that **3.2.4 also drifts warm under these saved T21 inputs**. They do not establish its final equilibrium temperature. The annual series, including both original baseline seeds, is saved in `stats/exoplasim-reference/version-3.2.4/annual-summary.json`.

### Reproduction and diagnostics

From the repository root, with the verified archive extracted into the comparison directory:

```powershell
wsl -d Ubuntu -- python3 stats/exoplasim-reference/version-3.2.4/build-comparison.py
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/reference.py run --build /var/tmp/chaos-exoplasim-3.2.4-t21-r8-p8 --inputs stats/exoplasim-reference/version-3.2.4/inputs --output stats/exoplasim-reference/runs/release-3.2.4-t21-p8-calendar-reproduction --years 11
wsl -d Ubuntu -- python3 stats/exoplasim-reference/version-3.2.4/summarize.py
```

The annual hook and Gaussian area weights are the same as the [original native reference](exoplasim-webgpu.md#fortran-references). Each full year contains 11,520 steps. Diagnostic labels 2–12 represent simulated years 1–11 in this run. The original 15-year baseline has labels 2–16; its mean over simulated years 6–15 (labels 7–16) is 292.8728469 K. Temperatures in the table use Gaussian area weights, which reproduce that documented baseline mean.

An initial attempt at `stats/exoplasim-reference/runs/release-3.2.4-t21-p8/` omitted the calendar interface repair and was interrupted after 159 seconds without annual diagnostics. It is excluded from the comparison.

## Author-recipe T21 test with wet-soil albedo enabled

This test uses the pinned source at the user's request and reproduces the published physical settings from [Worldbuilding Pasta's temperature exploration](https://worldbuildingpasta.blogspot.com/2022/05/climate-explorations-temperature.html), at T21 instead of T42. It tests the combined author recipe, not the isolated effect of changing wet-soil albedo.

The completed 80-year run gives **15.8871 °C global 2 m air temperature over years 71–80**, compared with the author's reported 15.5 °C. The balance criterion first passed at year 70, followed by the author's ten additional sampling years. This brings the pinned model close to the published result with fixed 1367 W/m² flux and approximately 300 ppm CO₂; no temperature correction or tuning was applied. The final rolling balance assessment rose above threshold again, as detailed below.

Inputs and provenance are in `stats/exoplasim-reference/author-t21/`. The author's actual 1024 × 512 `earthscale.png` has SHA256 `9df6395ce45379f823b1e9346c0fd7fae706edd82bf545dad775feb19c61ed14`. It is converted to 64 × 32 with the `Image2sra_2.0.3.py` tool linked in the author's tutorial: oceans enabled, ocean threshold 0, height scale 6300 m, gravity 9.80665 m/s². Palette-to-RGB conversion preserves the image's colors so the original converter can read it. The converter averages 16 × 16 image blocks, including fractional coastal land cover; it does not perform a Gaussian-latitude remapping. The tool's Git blob is `c990e6f3798ecaa74d1a8e453c5606ffbebe3401` in `hersfeldtn/koppenpasta`.

`prepare.py` calls the pinned `Model.configure` on upstream default namelists with the published settings: 1367 W/m², 5780 K, 360 days, circular fixed orbit, one-day rotation, 23.5° obliquity, partial pressures N₂/O₂/Ar = 0.78/0.21/0.01 bar, CO₂ partial pressure 0.0003 bar, ozone on, coupled vegetation with initial growth 0.5, glaciers on with minimum depth 2 m and initial height −1, and `gp|exp|sp` filtering. This gives total pressure 100030 Pa and CO₂ 299.910 ppm through the actual Python API. The vertical grid is its default type 0 with 10 layers.

The pinned wrapper overrides wet-soil albedo when `startemp` is supplied. The preparation script explicitly restores `NWETSOIL = 1` after configuration. The native diagnostic confirms that value. Supplying `landmap` and `topomap` through `Model.configure` also removes the other `.sra` surface-climatology inputs, leaving only terrain and land fraction. This differs from the earlier page-input references, which retained Earth surface climatology. The Python API's other defaults, including `NSIMPLEALBEDO = 1`, are preserved.

The timestep is 30 minutes, the author's stated usual T42 choice in the tutorial comments; the original baseline's `times.ini` is unavailable. The seed is the existing reference's `14963991,2,3,4,5,6,7,8`, because the author's seed is unpublished. These assumptions and the requested substitution of pinned source for the historical version prevent an exact historical reproduction. Raw output and snapshots are disabled; the existing all-step annual diagnostic hook measures both surface and 2 m air temperature, with 17,280 samples per full year.

The executable is an isolated, checksum-recorded copy of the original pinned f64, eight-rank T21 reference, including its original interface repairs and inactive radiation cache (`NRADINT = 1`). It does not incorporate later glacier patches. `build/model-source.patch`, `build/reference.json` and `manifest.json` preserve the build and input provenance.

A 96-step smoke test completed with exit code 0 in 1.58 seconds. Its final root-rank field dump contains 256 rows of six finite values. The startup diagnostic confirms `NWETSOIL = 1`, `NSTARTEMP = 1`, ozone, vegetation, glacier and filter switches. Files are in `stats/exoplasim-reference/runs/author-t21-wetsoil-on-smoke-v2/`. The first smoke launch used a relative executable path and never started the model; it is excluded.

`run-annual.py` initially requested 10 simulated years in `stats/exoplasim-reference/runs/author-t21-wetsoil-on-annual/`, with a native shutdown and restart after every year, as in the author's Python workflow. This matters because the original `glacierstop` commits persistent-snow glacier changes at shutdown. The runner retains native restart sidecars and copies each completed `plasim_status` to `plasim_restart`; per-year diagnostics and cumulative run metadata are preserved.

An initial continuous multi-year attempt in `stats/exoplasim-reference/runs/author-t21-wetsoil-on/` was interrupted and excluded once this execution-procedure difference was identified. The annual-restart series is the author-recipe trial. Compare its 2 m air temperature to the author's 15.5 °C figure; surface temperature is a separate field.

The user subsequently requested continuation toward balance. After the first 10 years, `python3 stats/exoplasim-reference/author-t21/run-annual.py --resume-to-balance` resumes the same checkpoint. It enforces the supplement's minimum 20 years, with a 1000-year safety limit, and calls the existing `GCM_BALANCE.assess` implementation. That implements upstream `_isbalanced`: absolute 10-year running energy means, slopes over five consecutive running means, and the absolute mean of the latest 30 slopes below `5e-4 W/m²/year` for both TOA and surface. Temperatures and fluxes use Gaussian area weights.

The initial evaluator loaded the balance module through `compare-climate.mjs`, using the run as both reference and candidate solely to reuse its balance calculation; its self-comparison pass was not an independent climate-validation result. After saving the valid year-40 report, that helper exited nonzero. The controller preserved the completed native checkpoint. The replacement `balance.mjs` transpiles and calls the same balance module directly, without Vite. At year 40 its drift results agree with the earlier report within `5e-15 W/m²/year`; the tiny difference comes from floating-point Gaussian averaging in Python versus JavaScript. `balance-helper-verification.json` records the comparison. The run resumed from year 40 without changing physical settings or repeating a completed year.

Once the criterion first passes, the controller collects 10 additional annual samples, following the author's stated sampling procedure. The balance report, trigger year, sampling count, finite checks, annual temperatures and energy fluxes are retained under the experiment directory and in the run metadata. Passing this drift criterion does not by itself require exactly zero net TOA flux; the measured flux is reported separately.

The first 10 annual runs completed successfully in 1708 seconds. Their annual means are preliminary spin-up measurements:

| Simulated year | 2 m air temperature (°C) | Surface temperature (°C) | Net TOA (W/m²) |
| --- | --- | --- | --- |
| 1 | −8.05 | −6.80 | +33.25 |
| 5 | 5.70 | 5.79 | +8.56 |
| 10 | 11.64 | 11.86 | +2.99 |

All 10 records contain 17,280 samples and finite values. These initial cold-start results cannot establish its equilibrium temperature or be used to attribute a cooling effect solely to wet-soil albedo.

The balance criterion first passed at **year 70**: TOA drift `0.0003871101 W/m²/year`, surface drift `0.0004399531 W/m²/year`, both below `0.0005`. The immutable assessment is `stats/exoplasim-reference/author-t21/balance-at-year-70.json`. The controller then completed years 71–80 as the additional sample, with no changes to physical settings. Later rolling assessments moved above threshold again, passed again at year 78, and were above threshold at year 80: TOA `0.0017805903 W/m²/year`, surface `0.0007247870 W/m²/year`. Following the author's first-pass-then-sample procedure therefore does not imply that the final rolling assessment passes or that the climate has no remaining drift.

| Quantity | Years 71–80 |
| --- | --- |
| Global 2 m air temperature | 15.8871 °C |
| Annual 2 m temperature standard deviation | 0.0698 °C |
| 2 m temperature linear trend | +0.01316 K/year |
| Global surface temperature | 16.3608 °C |
| Net TOA energy | −0.28923 W/m² |
| Net surface heat | +0.00349 W/m² |
| Difference from author's reported 2 m temperature | +0.3871 K |

All 80 annual records contain 17,280 samples and finite values. All native annual invocations exited successfully; the analysis-helper failure at year 40 was recovered as described above. The controller's accumulated elapsed time is 13,114 seconds (3.64 hours), including native execution and intervening analysis, excluding the stopped interval at that recovery. Final verification confirms the executable checksum, every prepared input checksum, all run input checksums except the expected duration/diagnostic changes in `plasim_namelist`, and native year-80 `NWETSOIL = 1`. `finalize.py` saves these checks and the final statistics in `stats/exoplasim-reference/author-t21/final-result.json`. `annual-summary.json` preserves the complete series; its rolling ten-year summary now corresponds exactly to the designated years 71–80. `temperature-history.png` plots the full temperature and energy history.

The full author recipe produces a climate close to 15.5 °C with the pinned physics at T21. Resolution, source version, unpublished seed/timestep and spatial averaging differences limit the historical comparison. This experiment cannot assign the cooling relative to the earlier warm page-input references solely to wet-soil albedo: terrain, removal of Earth surface climatology, timestep and other recipe differences changed together.

## Author recipe with page Earth maps and 45-minute steps

The follow-up requested by the user keeps the successful author recipe, including explicitly enabled `NWETSOIL = 1`, but substitutes the page reference's `N032_surf_0129.sra` terrain and `N032_surf_0172.sra` land mask and changes `MPSTEP` from 30 to 45 minutes. Only those three input files differ from the prepared author-recipe inputs. The other Earth surface-climatology files remain absent, so this test isolates the combined map/timestep change rather than restoring the entire warm page configuration. It does not isolate maps from timestep or toggle wet-soil albedo.

Gaussian-weighted fractional land cover changes from 24.4921% to 29.9797%; land area after the model's 0.5 threshold changes from 23.9406% to 29.7974%. `map-comparison.json` preserves these measurements. At the preliminary year-10 checkpoint the 2 m mean is 10.2876 °C, compared with 11.64 °C in the author-map run, and net TOA absorption is +2.3711 W/m². This is still a cold-start spin-up measurement, not an equilibrium comparison.

Inputs, checksums and preparation are saved under `stats/exoplasim-reference/author-earthmaps-t21/`; the cold-start native run is `stats/exoplasim-reference/runs/author-earthmaps-t21-45m-wetsoil-on/`. The same pinned executable, seed, eight ranks, f64 precision, T21 resolution, ten layers, annual shutdown/restart procedure and balance-then-ten-sample-years rule are retained. Each complete year now contains 11,520 diagnostic samples. The shared annual runner and balance helper accept the experiment directory and run name, preserving the earlier experiment's outputs.

The user requested a pause during year 24. The run is paused with **23 complete years** and its year-23 restart checkpoint preserved. Year 23's 2 m mean is **13.1302 °C**, surface mean 13.5170 °C, net TOA −0.3362 W/m² and net surface heat +0.05278 W/m². All 23 annual records contain 11,520 finite samples. The balance criterion had not passed, so this is a preliminary result. At the matched year-20 checkpoint it was 1.8465 K cooler than the author-map trial (12.9707 versus 14.8172 °C). The partial year 24 is excluded; resume uses `--resume-to-balance` in place of `--to-balance` below.

```powershell
wsl -d Ubuntu -- python3 stats/exoplasim-reference/author-earthmaps-t21/prepare.py
wsl -d Ubuntu -- python3 stats/exoplasim-reference/author-t21/run-annual.py --to-balance --experiment-directory stats/exoplasim-reference/author-earthmaps-t21 --run-name author-earthmaps-t21-45m-wetsoil-on
```
