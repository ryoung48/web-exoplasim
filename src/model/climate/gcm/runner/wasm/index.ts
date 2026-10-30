import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import { GCM_PREPARATION } from "@/model/climate/gcm/preparation"
import { GCM_ASSETS } from "@/model/climate/gcm/runner/assets"
import type {
	GcmCpuBuild,
	GcmRun,
	GcmRunRequest,
} from "@/model/climate/gcm/runner/types"
import type {
	GcmCpuManifest,
	GcmRankChoice,
	GcmWasmSession,
	GcmWasmWorkerLoad,
	GcmWasmWorkerResponse,
} from "@/model/climate/gcm/runner/wasm/types"

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

// scripts/exoplasim-wasm/build_app.py writes it; null when absent.
function manifest(): Promise<GcmCpuManifest | null> {
	return GCM_ASSETS.json<GcmCpuManifest>("manifest.json")
}

function pickRanks({ available, hardwareThreads }: GcmRankChoice): number {
	const physicalCores = Math.max(1, Math.floor(hardwareThreads / 2))
	const fitting = available.filter((ranks) => ranks <= physicalCores)
	return fitting.length > 0 ? Math.max(...fitting) : Math.min(...available)
}

// One Wasm run on `ranks` workers sharing memory, until it ends. Snapshots
// are averaged here, on the page, as the GPU engine does in its worker.
function session({
	request,
	files,
	ranks,
	averager,
	restart: restartIn,
	startPaused,
	onSaved,
}: GcmWasmSession): GcmRun {
	const base = GCM_ASSETS.url(`t${request.resolution.truncation}/`)
	const moduleBase = new URL(`layers-${request.config.layers}/`, base)
	const exchange = new SharedArrayBuffer(
		EXCHANGE_HEADER_BYTES + 2 * EXCHANGE_REGION_BYTES,
	)
	const controlBuffer = new SharedArrayBuffer(CONTROL_BYTES)
	const control = new Int32Array(controlBuffer)
	// Set before any worker runs, so a run resumed from a paused checkpoint
	// does not advance a step.
	if (startPaused) Atomics.store(control, PAUSED, 1)
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
		{ length: ranks },
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
		message: `Loading ExoPlaSim on ${ranks} workers`,
	})
	workers.forEach((worker, rank) => {
		worker.onerror = (event) => fail(event.message || "GCM worker crashed")
		worker.onmessage = (event: MessageEvent<GcmWasmWorkerResponse>) => {
			const response = event.data
			if (response.type === "loaded") {
				loaded++
				if (loaded === workers.length) {
					request.onDevice(String(ranks))
					request.onStatus(
						startPaused
							? { status: "paused", message: "Paused" }
							: { status: "running", message: "Running" },
					)
					for (const each of workers) each.postMessage({ type: "run" })
				}
			} else if (response.type === "snapshot") {
				if (GCM_AVERAGES.add({ averager, snapshot: response.snapshot }))
					request.onAverages({
						months: averager.months.slice(-GCM_AVERAGES.MONTHS_PER_YEAR),
						years: averager.years,
					})
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
				if (restart && checkpointRequested)
					onSaved({ restart, averager, targeting: null })
				else request.onStatus({ status: "finished", message: "Run complete" })
			}
		}
		const load: GcmWasmWorkerLoad = {
			type: "load",
			config: request.config,
			previousConfig: restartIn ? request.previousConfig : null,
			layers: request.config.layers,
			rank,
			size: ranks,
			exchange,
			control: controlBuffer,
			moduleUrl: new URL(`ranks-${ranks}/exoplasim.js`, moduleBase).href,
			dataUrl: new URL("exoplasim.data", base).href,
			files,
			keepSurfaceFiles: request.config.earthSurfaceClimatology,
			restart: rank === 0 ? restartIn : null,
			namelistEdits,
			publishEvery: request.publishEvery,
			spin: BARRIER_SPIN,
		}
		worker.postMessage(load)
	})

	return {
		pause() {
			Atomics.store(control, PAUSED, 1)
		},
		resume() {
			Atomics.store(control, PAUSED, 0)
			Atomics.notify(control, PAUSED)
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

// A Wasm run across checkpoints: each Save ends the current session, hands
// its plasim_status to onCheckpoint and continues in a new session from it,
// paused if the run was.
function start(request: GcmRunRequest): GcmRun {
	const build = request.resolution.cpu as GcmCpuBuild
	const ranks =
		request.ranks !== null && build.ranks.includes(request.ranks)
			? request.ranks
			: pickRanks({
					available: build.ranks,
					hardwareThreads: navigator.hardwareConcurrency,
				})
	const averager = request.averager ?? GCM_AVERAGES.create()
	let paused = request.startPaused
	let current: GcmRun | null = null
	let stopped = false
	const controller = new AbortController()
	request.onStatus({ status: "loading", message: "Preparing model terrain" })
	void GCM_PREPARATION.run({
		kind: "boundary",
		signal: controller.signal,
		input: {
			grid: GCM_GRID.forLatitudes(request.resolution.latitudes),
			terrain: request.terrain,
			gravityMs2: request.config.gravityMs2,
		},
	})
		.then((files) => {
			if (stopped) return
			let previousConfig = request.previousConfig
			const next = (restart: ArrayBuffer | null): GcmRun => {
				const currentRequest = { ...request, previousConfig }
				previousConfig = null
				return session({
					request: currentRequest,
					files,
					ranks,
					averager,
					restart,
					startPaused: paused,
					onSaved: (saved) => {
						if (stopped) return
						request.onCheckpoint(saved)
						if (!stopped) current = next(saved.restart)
					},
				})
			}
			current = next(request.restart)
		})
		.catch((error: unknown) => {
			if (!stopped)
				request.onStatus({
					status: "failed",
					message: error instanceof Error ? error.message : String(error),
				})
		})
	return {
		pause() {
			paused = true
			current?.pause()
			request.onStatus({ status: "paused", message: "Paused" })
		},
		resume() {
			paused = false
			current?.resume()
			request.onStatus({ status: "running", message: "Running" })
		},
		checkpoint: () => current?.checkpoint(),
		stop() {
			stopped = true
			controller.abort()
			current?.stop()
		},
	}
}

export const GCM_WASM_RUNNER = {
	manifest,
	start,
}
