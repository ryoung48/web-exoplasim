import { GCM_BOUNDARY } from "@/model/climate/gcm/boundary"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import type {
	GcmManifest,
	GcmRankChoice,
	GcmRun,
	GcmRunRequest,
	GcmWorkerLoad,
	GcmWorkerResponse,
} from "@/model/climate/gcm/runner/types"

const EXCHANGE_HEADER_BYTES = 64
const EXCHANGE_REGION_BYTES = 8 * 1024 * 1024
const CONTROL_BYTES = 16
const PAUSED = 0
const STOP = 1
// Measured in docs/climate/exoplasim-wasm.md: spin budgets from 0 to 2e6
// loads changed ten-day timings by less than run-to-run noise.
const BARRIER_SPIN = 20000
const RUN_YEARS = 1000
const DIAGNOSTIC_INTERVAL_STEPS = 1_000_000

function assetBase(): URL {
	return new URL(`${import.meta.env.BASE_URL}gcm/`, self.location.origin)
}

async function manifest(): Promise<GcmManifest> {
	const response = await fetch(new URL("manifest.json", assetBase()))
	if (!response.ok) {
		throw new Error(
			"GCM build missing: run `pnpm build:gcm-wasm` to create public/gcm",
		)
	}
	return (await response.json()) as GcmManifest
}

function pickRanks({ available, hardwareThreads }: GcmRankChoice): number {
	const physicalCores = Math.max(1, Math.floor(hardwareThreads / 2))
	const fitting = available.filter((ranks) => ranks <= physicalCores)
	return fitting.length > 0 ? Math.max(...fitting) : Math.min(...available)
}

function start(request: GcmRunRequest): GcmRun {
	if (
		request.config.layers !== request.resolution.layers ||
		request.config.truncation !== request.resolution.truncation
	)
		throw new Error(
			"Model build does not match the selected resolution and atmospheric layers",
		)
	const base = new URL(`t${request.resolution.truncation}/`, assetBase())
	const exchange = new SharedArrayBuffer(
		EXCHANGE_HEADER_BYTES + 2 * EXCHANGE_REGION_BYTES,
	)
	const controlBuffer = new SharedArrayBuffer(CONTROL_BYTES)
	const control = new Int32Array(controlBuffer)
	// Set before any worker runs, so a run resumed from a paused checkpoint
	// does not advance a step.
	if (request.startPaused) Atomics.store(control, PAUSED, 1)
	const files = GCM_BOUNDARY.files(
		GCM_BOUNDARY.fromTerrain({
			gravityMs2: request.config.gravityMs2,
			grid: GCM_GRID.forLatitudes(request.resolution.latitudes),
			terrain: request.terrain,
		}),
	)
	const edits = GCM_NAMELIST.edits(request.config)
	const namelistEdits = {
		...edits,
		plasim_namelist: {
			...edits.plasim_namelist,
			N_RUN_YEARS: String(RUN_YEARS),
			N_RUN_MONTHS: "0",
			N_RUN_DAYS: "0",
			N_RUN_STEPS: "0",
			NDIAG: String(DIAGNOSTIC_INTERVAL_STEPS),
		},
	}
	const workers = Array.from(
		{ length: request.ranks },
		() =>
			new Worker(new URL("./gcm.worker.ts", import.meta.url), {
				type: "module",
			}),
	)
	let loaded = 0
	let exited = 0
	let stopped = false
	let checkpointRequested = false
	let restart: ArrayBuffer | null = null

	const stop = () => {
		stopped = true
		for (const worker of workers) worker.terminate()
	}
	const fail = (message: string) => {
		if (stopped) return
		stop()
		request.onStatus({ status: "failed", message })
	}

	request.onStatus({
		status: "loading",
		message: `Loading ExoPlaSim on ${request.ranks} workers`,
	})
	workers.forEach((worker, rank) => {
		worker.onerror = (event) => fail(event.message || "GCM worker crashed")
		worker.onmessage = (event: MessageEvent<GcmWorkerResponse>) => {
			const response = event.data
			if (response.type === "loaded") {
				loaded++
				if (loaded === workers.length) {
					request.onStatus(
						request.startPaused
							? { status: "paused", message: "Paused" }
							: { status: "running", message: "Running" },
					)
					for (const each of workers) each.postMessage({ type: "run" })
				}
			} else if (response.type === "snapshot") {
				request.onSnapshot(response.snapshot)
			} else if (response.type === "error") {
				fail(`Rank ${rank}: ${response.message}\n${response.log.join("\n")}`)
			} else if (response.code !== 0) {
				fail(
					`Rank ${rank} exited with code ${response.code}\n${response.log.join("\n")}`,
				)
			} else {
				restart = response.restart ?? restart
				if (++exited < workers.length) return
				if (checkpointRequested && !restart) {
					fail("The model ended without writing plasim_status")
					return
				}
				stop()
				if (restart && checkpointRequested) request.onCheckpoint(restart)
				else request.onStatus({ status: "finished", message: "Run complete" })
			}
		}
		const load: GcmWorkerLoad = {
			type: "load",
			layers: request.config.layers,
			rank,
			size: request.ranks,
			exchange,
			control: controlBuffer,
			moduleUrl: new URL(
				`layers-${request.config.layers}/ranks-${request.ranks}/exoplasim.js`,
				base,
			).href,
			dataUrl: new URL("exoplasim.data", base).href,
			files,
			keepSurfaceFiles: request.config.earthSurfaceClimatology,
			restart: rank === 0 ? request.restart : null,
			namelistEdits,
			publishEvery: request.publishEvery,
			spin: BARRIER_SPIN,
		}
		worker.postMessage(load)
	})

	return {
		pause() {
			Atomics.store(control, PAUSED, 1)
			request.onStatus({ status: "paused", message: "Paused" })
		},
		resume() {
			Atomics.store(control, PAUSED, 0)
			Atomics.notify(control, PAUSED)
			request.onStatus({ status: "running", message: "Running" })
		},
		// Ends the run cleanly at the next step so PlaSim's epilog writes its
		// restart file, as ExoPlaSim's Python wrapper does between runs.
		checkpoint() {
			checkpointRequested = true
			Atomics.store(control, STOP, 1)
			Atomics.notify(control, PAUSED)
			request.onStatus({
				status: "checkpointing",
				message: "Saving checkpoint",
			})
		},
		stop,
	}
}

export const GCM_RUNNER = {
	manifest,
	pickRanks,
	start,
}
