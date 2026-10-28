import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import type { GcmNamelistFile } from "@/model/climate/gcm/namelist/types"
import { GCM_PREPARATION } from "@/model/climate/gcm/preparation"
import { GCM_ASSETS } from "@/model/climate/gcm/runner/assets"
import { GCM_INPUTS } from "@/model/climate/gcm/runner/inputs"
import type {
	GcmGpuInputs,
	GcmRun,
	GcmRunRequest,
} from "@/model/climate/gcm/runner/types"
import type {
	GcmGpuFileRequest,
	GcmGpuManifest,
	GcmInputs,
	GcmWorkerRequest,
	GcmWorkerResponse,
} from "@/model/climate/gcm/runner/webgpu/types"

// scripts/exoplasim-webgpu/package-inputs.mjs writes it; null when absent.
function manifest(): Promise<GcmGpuManifest | null> {
	return GCM_ASSETS.json<GcmGpuManifest>("webgpu.json")
}

// Whether this browser can run the WebGPU model: it has WebGPU and an
// adapter (a page with WebGPU disabled or blocklisted has neither).
async function available(): Promise<boolean> {
	if (!navigator.gpu) return false
	try {
		return (await navigator.gpu.requestAdapter()) !== null
	} catch {
		return false
	}
}

// The files SETUP reads, as scripts/exoplasim-wasm/export-page-inputs.mjs
// assembles them: the base namelists, the Earth surface climatologies when
// the panel keeps them, the page's orography and land mask, then the
// panel's namelist edits.
async function files({
	request,
	signal,
}: GcmGpuFileRequest): Promise<Record<string, string>> {
	const gpu = request.resolution.gpu as GcmGpuInputs
	const path = request.config.earthSurfaceClimatology
		? gpu.inputs
		: `t${request.resolution.truncation}/namelists.json`
	const [inputs, boundary] = await Promise.all([
		GCM_ASSETS.json<GcmInputs>(path),
		GCM_PREPARATION.run({
			kind: "boundary",
			signal,
			input: {
				grid: GCM_GRID.forLatitudes(request.resolution.latitudes),
				terrain: request.terrain,
				gravityMs2: request.config.gravityMs2,
			},
		}),
	])
	if (!inputs) throw new Error(`Missing ${path} in public/gcm`)
	const edits = GCM_NAMELIST.edits(request.config)
	const result = Object.fromEntries(
		Object.entries(inputs.files).filter(
			([name]) =>
				name.endsWith("_namelist") ||
				(name.endsWith(".sra") &&
					GCM_INPUTS.keepSurfaceFile({
						name,
						keepSurfaceFiles: request.config.earthSurfaceClimatology,
						namelistEdits: edits,
					})),
		),
	)
	Object.assign(result, boundary)
	for (const [file, values] of Object.entries(edits)) {
		const name = file as GcmNamelistFile
		result[name] = GCM_NAMELIST.apply({ text: result[name], values })
	}
	return result
}

function start(request: GcmRunRequest): GcmRun {
	const controller = new AbortController()
	const worker = new Worker(new URL("./gcm.worker.ts", import.meta.url), {
		type: "module",
	})
	const send = (message: GcmWorkerRequest) => worker.postMessage(message)
	let stopped = false
	const stop = () => {
		if (stopped) return
		stopped = true
		controller.abort()
		send({ type: "stop" })
		worker.terminate()
	}
	const fail = (message: string) => {
		if (stopped) return
		stop()
		request.onStatus({ status: "failed", message })
	}
	request.onStatus({ status: "loading", message: "Loading the WebGPU model" })
	worker.onerror = (event) => fail(event.message || "GCM worker crashed")
	worker.onmessage = (event: MessageEvent<GcmWorkerResponse>) => {
		const response = event.data
		if (response.type === "loaded") {
			request.onDevice(response.device)
			request.onStatus(
				request.startPaused
					? { status: "paused", message: "Paused" }
					: { status: "running", message: "Running" },
			)
		} else if (response.type === "progress") {
			if (response.averages) request.onAverages(response.averages)
			request.onSnapshot(response.latest)
		} else if (response.type === "checkpoint") {
			request.onCheckpoint({
				restart: response.restart,
				averager: response.averager,
			})
		} else {
			fail(response.message)
		}
	}
	void files({ request, signal: controller.signal }).then(
		(inputs) => {
			if (stopped) return
			const restart = request.restart
			worker.postMessage(
				{
					type: "start",
					truncation: request.resolution.truncation,
					layers: request.config.layers,
					files: inputs,
					restart,
					averager: request.averager,
					publishEvery: request.publishEvery,
					startPaused: request.startPaused,
				} satisfies GcmWorkerRequest,
				restart ? [restart] : [],
			)
		},
		(error: unknown) =>
			fail(error instanceof Error ? error.message : String(error)),
	)
	return {
		pause() {
			send({ type: "pause" })
			request.onStatus({ status: "paused", message: "Paused" })
		},
		resume() {
			send({ type: "resume" })
			request.onStatus({ status: "running", message: "Running" })
		},
		// The worker saves the state at the next batch boundary and keeps
		// running (or stays paused).
		checkpoint() {
			send({ type: "checkpoint" })
		},
		stop,
	}
}

export const GCM_WEBGPU_RUNNER = {
	manifest,
	available,
	start,
}
