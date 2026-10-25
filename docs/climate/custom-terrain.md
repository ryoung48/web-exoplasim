# Custom terrain

Open `/gcm` and use **Terrain** before starting a run. Choose a heightmap, optionally choose a matching land mask, inspect the source and model-grid previews, and select **Apply terrain**. Applying clears previous results and disables Earth surface climatology. **Use Earth** restores the bundled geography and enables Earth surface climatology. Clear an active run before replacing terrain.

Files are read locally in the browser. There is no upload service.

## Coordinates and files

All inputs cover the entire world in equirectangular coordinates. Pixel centres run west to east from −180° to +180°, and north to south from +90° to −90°. The image must be twice as wide as it is tall, from 4 × 2 through 4096 × 2048 pixels. Files larger than 64 MiB are rejected before reading their contents. Regional maps and other projections must be converted before import.

- **PNG heightmap:** grayscale, including 8-bit and 16-bit samples. RGB/RGBA files are accepted when their channels are grayscale and all pixels are opaque. Decoding uses the stored numerical samples directly, preserving 16-bit precision without canvas color conversion. Black and white elevation controls define a linear mapping; their defaults are −8 km and +8 km. The controls support −12 km through +20 km. Colored map screenshots and missing/transparent pixels are rejected.
- **Chaos Machine `.bin`:** exactly 1440 × 720 signed little-endian 16-bit elevations in metres, or 2,073,600 bytes. This is the file from Chaos Machine's **WebGCM** export, not a serialized world or native `.gcmworld` file. Heights are read directly; black/white controls do not apply.
- **Land-mask PNG:** the same dimensions and coordinates as the heightmap. White is land, black is water; grayscale values at or above halfway are land. **Invert mask** reverses the interpretation. The explicit mask determines geography even where elevation is zero or below sea level. Without a mask, only elevations strictly above the chosen sea level count as land.

Sea level defaults to zero. It is subtracted from imported heights. With a supplied mask, changing sea level changes relative heights while retaining the mask's land/water labels. Ocean bathymetry is retained in the source terrain but contributes zero to the atmospheric surface geopotential.

## Chaos Machine

In Chaos Machine's world viewer, choose **WebGCM** and **Export WebGCM terrain** to download `chaos-world-<seed>.bin`. Then choose **Land mask** and **Export land mask PNG** to download `chaos-world-<seed>.land-mask.png`. Export both from the same world without regenerating between downloads.

Both exports sample the same nearest world region at each raster pixel. The mask uses `isLand`, preserving inland water above sea level and land at or below sea level. Displayed map rotation does not affect either file. Load the binary as the heightmap and the PNG as its mask in ExoPlaSim.

## Model and display

The terrain domain stores elevation and land coverage independently. Boundary generation and downscaling share a spherical-area overlap sampler, including longitude wrapping. Coarse inputs cover every model cell rather than leaving empty cells. Land fraction is the covered land area divided by total cell area; geopotential is gravity times the area mean of land elevation, with water contributing zero. Negative land elevation remains negative.

The preview shows how geography changes on the selected T21 or T42 Gaussian grid. Source detail can disappear at that resolution. Coastline overlays use the selected mask. The display grid is capped at 720 × 360 and is rebuilt when terrain or model resolution changes; smaller input maps remain smaller. Downscaling uses the same mask as the simulation.

Checkpoints embed the complete terrain alongside restart data and climate averages. Format 3 is required; older checkpoint formats are rejected. Loading a checkpoint restores its terrain without the original files.

## Verification

Generate reproducible fixtures using an existing Chaos Machine world saved with Node's V8 serializer:

```powershell
node --max-old-space-size=8192 scripts/exoplasim-wasm/export-chaos-fixture.mjs C:/path/to/chaos-machine C:/path/to/world.bin
pnpm dev --host 127.0.0.1 --port 5176 --strictPort
node scripts/exoplasim-wasm/verify-terrain-import.mjs
```

The fixture exporter reads the other checkout and writes only under `stats/terrain-import/` in this repository. It calls Chaos Machine's actual terrain exporter, then writes aligned binary, mask, 16-bit PNG and 8-bit PNG fixtures. `TERRAIN_TEST_URL` overrides the browser test's default `http://127.0.0.1:5176`. Run with other GCM simulations and benchmarks stopped.

The browser checks elevation precision, independent masks, inversion, north/south and east/west orientation at T21 and T42, constant zero/negative land, finite regridded fields, downscaling, checkpoint array round trips, upload/previews, model startup, pause/save/load, and invalid-file rejection. Reports, PNG screenshots and a real checkpoint remain under `stats/terrain-import/`. Required repository checks are `pnpm lint` and `pnpm typecheck`. The standalone Fortran benchmark runner does not exercise this importer; no Fortran or Wasm rebuild is needed for these changes.
