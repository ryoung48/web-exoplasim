# WebGPU startup

GPU startup builds the initial model state and transform tables, creates shader pipelines, uploads state, and executes three native startup phases before the main loop. It previously requested 383 compute pipelines for a ten-layer fresh start, recreating unchanged shaders and pipelines in each phase.

`kernel/` now caches shader modules by source and pipeline promises by source plus sorted override constants within each kernel context. The context fixes dimensions, buffer offsets, device and pipeline layout, so kernels cannot leak across incompatible runs. Changed timestep constants still produce distinct pipelines; labels do not affect identity. Caching the pending promise also deduplicates concurrent requests. This reduces pipeline creation to 129 requests in the measured cases.

The worker requests the main, snapshot and startup-phase pipelines concurrently. Once ready, it submits the three startup phases in their original order, with each phase's original constants and `bm1` table. Checkpoint loads request only the main and snapshot pipelines and retain their existing restart path. These changes add no per-step cache lookups or physics changes.

When Earth surface climatology is off, the runner fetches `tNN/namelists.json` instead of the full `inputs.json`. Each namelist-only package is 1,989 bytes. Enabling climatology still loads the complete package and applies the same surface-file filtering. `package-inputs.mjs` generates both assets together for T21, T42 and T63. The resolution selector's download-size metadata continues to describe the full package.

## Local measurements, 2026-10-28

Chrome 156.0.8078.48, RTX 2070 SUPER, local Vite development server, ten layers, custom 4 × 2 continent terrain, 20-minute model steps and publication every 128 steps. Each run uses a new worker/device. The measurements include normal browser/driver caches; they are not cold-cache network benchmarks or equilibrium runs.

| Resolution / climatology | Original first snapshot | Optimized first snapshot, two checks |
| --- | --- | --- |
| T21 / off | 1.91 s | 1.35–1.55 s |
| T21 / on | 2.98 s | 1.07–1.24 s |
| T63 / off | 3.93 s | 1.71–2.19 s |
| T63 / on | 4.45 s | 2.62–3.12 s |

The original pipeline-creation/startup-phase span was approximately 1.10 s at T21 with climatology off and 2.76 s at T63. In the first optimized check those spans were approximately 0.64 s and 0.72 s. Timings vary with driver caching, device acquisition, development-server work and system load; these few samples are indicative rather than statistical estimates. The second optimized check overlapped a production build. No steady-state throughput improvement is claimed.

## Verification

`scripts/exoplasim-webgpu/verify-load.mjs` adds timing and pipeline-count instrumentation only in its Vite server. It does not ship instrumentation in the application. Run `node scripts/exoplasim-webgpu/verify-load.mjs baseline` before editing startup, then `node scripts/exoplasim-webgpu/verify-load.mjs current` afterward. Reports live in `stats/exoplasim-webgpu/load/`.

The optimized check requires exactly the expected input-asset request and compares full-snapshot FNV fingerprints at the same first published step against the saved baseline. T21/T63 with climatology off/on matched bit for bit in both optimized checks. The same namelists are preserved in the small and full packages. `verify-snapshot.mjs` covers five/ten-layer diagnostic packing, extrema, DTR, restart state and T21/T42 custom-terrain runs. `verify-inputs.mjs` covers input combinations and checkpoint continuation. Required repository checks are `pnpm lint`, `pnpm typecheck` and `pnpm build`.

## Further overlap experiment, 2026-10-28

Moving state upload and checkpoint decoding before the pipeline-compilation await preserves snapshot fingerprints, but two paired checks did not show a repeatable end-to-end improvement over the already optimized runner. With climatology off, T21 first-snapshot samples were 1.38/1.70 s for the control and 1.54/1.82 s for overlap; T63 samples were 1.69/2.01 s and 1.86/2.14 s respectively. The tests ran sequentially, alternating control and overlap, with the configuration above. The few samples do not establish a regression magnitude, but do not support keeping the attempted optimization. Production startup ordering was retained.

The small upload work is not the main initialization cost. Initial state and schedule computation must precede pipeline creation because shader constants depend on the terrain-derived mean surface pressure, and shader headers include table-layout offsets. Starting device acquisition beside synchronous initialization also failed to improve the trial: JavaScript work delayed continuation from adapter acquisition to device creation. That change was removed too.

The upload experiment remains reproducible in the test server only:

```powershell
node scripts/exoplasim-webgpu/verify-load.mjs serial-1
node scripts/exoplasim-webgpu/verify-load.mjs overlap-1 overlap
node scripts/exoplasim-webgpu/verify-load.mjs serial-2
node scripts/exoplasim-webgpu/verify-load.mjs overlap-2 overlap
```

These commands compare snapshot fingerprints against `baseline.json`, which should be captured before an experiment. The original pre-cache report was preserved as `stats/exoplasim-webgpu/load/original-383-pipelines.json` when recording the new 129-pipeline baseline. All four configurations retained their full-snapshot fingerprints after the overlap trial and after returning to the retained startup order.

## Map loading and responsiveness

The map displays a pulsing skeleton while model loading is in progress and until the first live snapshot arrives. The map region exposes `aria-busy`, the placeholder has a status label, and reduced-motion settings disable the pulse. Successful startup, failure and Clear all remove the loading placeholder.

Display-grid preparation and terrain-to-model boundary conversion now run in short-lived `preparation/` workers instead of the page's main thread. CPU and GPU runners share boundary preparation; CPU checkpoint sessions reuse the prepared boundary strings. Display-grid result buffers are transferred back to the page, retaining ownership of the original terrain. Clear, a replacement launch and unmount cancel pending work and terminate its worker. This change targets UI responsiveness without changing model physics or shader startup order.

`node scripts/exoplasim-webgpu/verify-loading.mjs` compares worker-generated boundary strings and downscale arrays with synchronous results, checks cancellation/error handling and retained terrain buffers, then exercises actual T63 startup, animation, reduced motion, Clear/retry and failure cleanup. In the development check, the settings-panel toggle responded in 71 ms during startup; the longest observed main-thread long task was 110 ms. Full-snapshot fingerprints at T21/T63, with climatology off/on, remained equal to the saved baseline. CPU T21 checks covered both layer counts and 2/4/8 workers, including paused checkpoint continuation. These are functional and interaction-latency checks, not throughput measurements.

For the compiled application, run `pnpm build`, set `$env:PREVIEW = '1'`, then run the loading verifier. Reports and screenshots are written to `stats/exoplasim-webgpu/loading/` or `stats/exoplasim-webgpu/loading-build/`.

The production-build check passed with a 56 ms settings-panel response and a longest main-thread long task of 79 ms during T63 startup. It also passed animation/reduced-motion, Clear/retry, failure cleanup and finite-output checks, with no page errors.
