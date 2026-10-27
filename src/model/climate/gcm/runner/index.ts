import { GCM_BOUNDARY } from "@/model/climate/gcm/boundary"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import type { GcmNamelistFile } from "@/model/climate/gcm/namelist/types"
import type {
	GcmInputs,
	GcmManifest,
	GcmRun,
	GcmRunRequest,
	GcmWorkerRequest,
	GcmWorkerResponse,
} from "@/model/climate/gcm/runner/types"

function assetBase(): URL {
	return new URL(`${import.meta.env.BASE_URL}gcm/`, self.location.origin)
}

async function manifest(): Promise<GcmManifest> {
	const response = await fetch(new URL("manifest.json", assetBase()))
	if (!response.ok) {
		throw new Error(
			"GCM inputs missing: run `node scripts/exoplasim-webgpu/package-inputs.mjs` to create public/gcm",
		)
	}
	return (await response.json()) as GcmManifest
}

// The files SETUP reads, as scripts/exoplasim-wasm/export-page-inputs.mjs
// assembles them: the base namelists, the Earth surface climatologies when
// the panel keeps them, the page's orography and land mask, then the
// panel's namelist edits.
async function files(request: GcmRunRequest): Promise<Record<string, string>> {
	const response = await fetch(new URL(request.resolution.inputs, assetBase()))
	if (!response.ok)
		throw new Error(`Missing ${request.resolution.inputs} in public/gcm`)
	const inputs = (await response.json()) as GcmInputs
	const result = Object.fromEntries(
		Object.entries(inputs.files).filter(
			([name]) =>
				name.endsWith("_namelist") ||
				(request.config.earthSurfaceClimatology && name.endsWith(".sra")),
		),
	)
	Object.assign(
		result,
		GCM_BOUNDARY.files(
			GCM_BOUNDARY.fromElevation({
				grid: GCM_GRID.forLatitudes(request.resolution.latitudes),
				elevation: request.elevation,
			}),
		),
	)
	for (const [file, values] of Object.entries(
		GCM_NAMELIST.edits(request.config),
	)) {
		const name = file as GcmNamelistFile
		result[name] = GCM_NAMELIST.apply({ text: result[name], values })
	}
	return result
}

function start(request: GcmRunRequest): GcmRun {
	const worker = new Worker(new URL("./gcm.worker.ts", import.meta.url), {
		type: "module",
	})
	const send = (message: GcmWorkerRequest) => worker.postMessage(message)
	let stopped = false
	const stop = () => {
		if (stopped) return
		stopped = true
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
	void files(request).then(
		(inputs) => {
			if (stopped) return
			const restart = request.restart
			worker.postMessage(
				{
					type: "start",
					truncation: request.resolution.truncation,
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

export const GCM_RUNNER = {
	manifest,
	start,
}
