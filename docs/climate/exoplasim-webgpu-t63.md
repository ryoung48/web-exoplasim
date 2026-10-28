# T63 on WebGPU

The GPU engine supports T63 with 192 longitudes, 96 Gaussian latitudes and either 5 or 10 atmospheric layers. It uses the existing resolution-dependent transforms and physics kernels. T21 and T42 retain their settings. The CPU manifest still contains only T21 and T42, so the page hides T63 for CPU and switches to an available CPU resolution when changing engines from T63.

Selecting T63 changes timesteps above 20 minutes to 20 minutes. This follows the pinned native `plasim.f90` default, `30 * 64 / NLAT`, at 96 latitudes. Smaller selected timesteps are retained. The panel also offers 20 minutes explicitly. A longer check at the inherited 45-minute setting became unstable, so that setting is unsuitable as the T63 starting preset. This does not establish long-term climate stability at 20 minutes.

## Boundary data

The pinned ExoPlaSim source has no `plasim/dat/T63` directory. `scripts/exoplasim-webgpu/package-inputs.mjs` generates T63 climatologies from the bundled T42 files using nearest Gaussian latitude and periodic nearest longitude. Nearest-neighbour selection preserves categorical glacier flags and unset sentinels without mixing them into adjacent cells. Each monthly record retains its date and field code; dimensions and filenames become 192 × 96 and `N096_surf_…`.

These climatologies retain T42 spatial detail. Terrain and land fraction are independently regridded from the page's selected terrain at T63, as at the other resolutions. The generated `public/gcm/t63/inputs.json` is about 8.50 MB. Regenerate all three GPU packages with:

```powershell
node scripts/exoplasim-webgpu/package-inputs.mjs
```

T63 adds no special physics passes to lower-resolution runs. It has 2.25 times the grid cells of T42 and larger spectral transforms; its execution cost requires separate measurement.

## Verification

```powershell
node scripts/exoplasim-webgpu/verify-resolution.mjs 63
pnpm lint
pnpm typecheck
pnpm build
```

The browser check runs both layer counts, with Earth surface climatologies enabled and disabled, on custom continent terrain at 20-minute timesteps. It checks finite full-size snapshots, temperature extrema, serialized checkpoint validation, and identical continuation at common published steps after reload. It also checks GPU selection, automatic timestep selection and CPU unavailability. Reports live in `stats/exoplasim-webgpu/t63/verification.json`.

This is a short-run integration check, not native trajectory parity or equilibrium-climate validation at T63. No throughput benchmark is included.
