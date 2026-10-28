import type {
	GcmResolution,
	GcmRun,
	GcmRunRequest,
} from "@/model/climate/gcm/runner/types"
import { GCM_WASM_RUNNER } from "@/model/climate/gcm/runner/wasm"
import { GCM_WEBGPU_RUNNER } from "@/model/climate/gcm/runner/webgpu"
import type { GcmLayerCount } from "@/model/climate/gcm/types"

// Every resolution either engine is built for, with each engine's assets.
async function resolutions(): Promise<GcmResolution[]> {
	const [cpu, gpu] = await Promise.all([
		GCM_WASM_RUNNER.manifest(),
		GCM_WEBGPU_RUNNER.manifest(),
	])
	if (!cpu && !gpu)
		throw new Error(
			"GCM assets missing: run `pnpm build:gcm-wasm` or `node scripts/exoplasim-webgpu/package-inputs.mjs` to create public/gcm",
		)
	const result = new Map<string, GcmResolution>()
	for (const entry of cpu?.resolutions ?? [])
		result.set(`${entry.truncation}/${entry.layers}`, {
			layers: entry.layers,
			truncation: entry.truncation,
			latitudes: entry.latitudes,
			cpu: {
				precisionBytes: entry.precisionBytes,
				ranks: entry.ranks,
				downloadBytes: entry.downloadBytes,
			},
			gpu: null,
		})
	for (const entry of gpu?.resolutions ?? []) {
		const gpuInputs = {
			inputs: entry.inputs,
			downloadBytes: entry.downloadBytes,
		}
		for (const layers of [
			5, 10,
		] as const satisfies ReadonlyArray<GcmLayerCount>) {
			const key = `${entry.truncation}/${layers}`
			const existing = result.get(key)
			result.set(
				key,
				existing
					? { ...existing, gpu: gpuInputs }
					: {
							layers,
							truncation: entry.truncation,
							latitudes: entry.latitudes,
							cpu: null,
							gpu: gpuInputs,
						},
			)
		}
	}
	return [...result.values()].sort((a, b) => a.truncation - b.truncation)
}

function start(request: GcmRunRequest): GcmRun {
	if (
		request.config.layers !== request.resolution.layers ||
		request.config.truncation !== request.resolution.truncation
	)
		throw new Error(
			"Model assets do not match the configured resolution and layers",
		)
	if (!request.resolution[request.engine])
		throw new Error(
			`T${request.resolution.truncation} is not built for the ${request.engine.toUpperCase()} engine`,
		)
	return request.engine === "gpu"
		? GCM_WEBGPU_RUNNER.start(request)
		: GCM_WASM_RUNNER.start(request)
}

export const GCM_RUNNER = {
	resolutions,
	gpuAvailable: GCM_WEBGPU_RUNNER.available,
	start,
}
