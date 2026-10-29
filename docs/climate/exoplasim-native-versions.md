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

### Reproduction and diagnostics

From the repository root, with the verified archive extracted into the comparison directory:

```powershell
wsl -d Ubuntu -- python3 stats/exoplasim-reference/version-3.2.4/build-comparison.py
wsl -d Ubuntu -- python3 scripts/exoplasim-wasm/reference.py run --build /var/tmp/chaos-exoplasim-3.2.4-t21-r8-p8 --inputs stats/exoplasim-reference/version-3.2.4/inputs --output stats/exoplasim-reference/runs/release-3.2.4-t21-p8-calendar --years 15
node scripts/exoplasim-wasm/compare-climate.mjs --reference stats/exoplasim-reference/runs/gate-t21-p8 --candidate stats/exoplasim-reference/runs/release-3.2.4-t21-p8-calendar --discard 5 --output stats/exoplasim-reference/version-3.2.4/comparison.json
```

The annual hook and Gaussian area weights are the same as the [original native reference](exoplasim-webgpu.md#fortran-references). Each full year contains 11,520 steps. The diagnostic year labels run from 2 to 16 for 15 simulated years; the first record represents simulated year 1. Discarding five records therefore compares simulated years 6–15, whose file labels are 7–16. The baseline's mean over those records is 292.8728469 K.

An initial attempt at `stats/exoplasim-reference/runs/release-3.2.4-t21-p8/` omitted the calendar interface repair and was interrupted after 159 seconds without annual diagnostics. It is excluded from the comparison.
