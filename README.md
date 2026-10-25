# web-exoplasim

The [ExoPlaSim](https://github.com/alphaparrot/ExoPlaSim) general circulation model, compiled from its Fortran source to WebAssembly and run in the browser across shared-memory Web Workers. The `/gcm` page runs it on an Earth heightmap and shows the climate live as the model steps.

This repository was split out of Chaos Machine with the same folder layout and tooling.

## Run the page

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173/gcm`. The built model is already in `public/gcm/`, so no toolchain is needed to run the page. The dev server sends the cross-origin isolation headers that `SharedArrayBuffer` requires (see `vite.config.ts`). Production hosts without these headers use `public/isolation-worker.js`; the page reloads once after installing the service worker, then starts the app with cross-origin isolation.

## GitHub Pages

The live site is [ryoung48.github.io/web-exoplasim](https://ryoung48.github.io/web-exoplasim/). Pushes to `main` deploy automatically through [the Pages workflow](.github/workflows/pages.yml), which can also be run manually from GitHub Actions. The repository's Settings → Pages → Source must be set to **GitHub Actions**.

The workflow builds with the Pages base path and uses the committed Wasm assets, so deployment does not require WSL or rebuilding Fortran. It also copies the app entry point to `gcm/index.html` so direct links and refreshes on `/web-exoplasim/gcm/` work. The isolation service worker is scoped to this app and passes requests through without caching. Browsers must support service workers and cross-origin isolation.

What the page does:

- Runs ExoPlaSim at T21 (64×32, 4.6 MB download) or T42 (128×64, 12.7 MB) on 2, 4 or 8 workers. Choose **Workers** under **Settings → Numerics** before starting a run, or leave **Auto** to pick from the machine's core count. Clear the run to change the selection. Choices come from the available builds for the selected resolution; only the chosen resolution and worker count are downloaded.
- Builds the model's topography and land mask from `public/earth-data/earth-real-elevation.bin.gz`. By default it keeps ExoPlaSim's shipped Earth surface data (sea-surface temperature and sea ice to start from, albedo, vegetation, soil, glaciers); turn that off to use the Python wrapper's custom-map behaviour.
- Exposes the planet settings of ExoPlaSim's `Model.configure()`: flux, star temperature, orbit, rotation, gases, ozone, soil, vegetation, glaciers, filters, timestep and radiation interval.
- Maps 13 surface fields live, as monthly means or as annual means, plus Köppen classes after a full model year, on the model grid or downscaled to 0.5° with lapse-rate correction.
- Reports top-of-atmosphere and surface energy balance, with ExoPlaSim's own equilibrium test.
- Saves checkpoints using ExoPlaSim's restart file, and resumes from them.

## Rebuild the model

The Wasm build needs Windows with WSL (Ubuntu). See [scripts/exoplasim-wasm/README.md](scripts/exoplasim-wasm/README.md):

```powershell
wsl -d Ubuntu -- bash scripts/exoplasim-wasm/setup.sh
pnpm build:gcm-wasm
```

## Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm build` | Typecheck and production build |
| `pnpm typecheck` | `tsc -b` |
| `pnpm lint` | Biome check with fixes |
| `pnpm knip` | Unused files and exports |
| `pnpm check:optional-attributes`, `pnpm check:underscore-unused`, `pnpm fix:import-aliases` | Repository convention checks from `AGENTS.md` |

Code layout:

| Path | Contents |
| --- | --- |
| `src/model/climate/gcm/` | Model-side TypeScript: grid, boundary files, namelists, worker runner, averages, balance, checkpoints, downscaling |
| `src/ui/gcm/` | The `/gcm` page |
| `src/ui/components/`, `src/ui/genesis/shared/` | Shared UI primitives, tokens, colour ramps and formatting carried over from Chaos Machine |
| `scripts/exoplasim-wasm/` | Wasm build, shared-memory MPI layer, browser benchmark runner |
| `docs/climate/exoplasim-wasm.md` | Design notes, measurements and results |
| `public/gcm/` | Built model assets |
| `public/earth-data/` | Earth heightmap and coastlines |

## Licence

ExoPlaSim and PlaSim are distributed under the GNU General Public License; `public/gcm/COPYING` is ExoPlaSim's licence text and applies to the compiled model assets.
