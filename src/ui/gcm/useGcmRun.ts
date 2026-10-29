import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { GCM } from "@/model/climate/gcm"
import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import { GCM_CHECKPOINT } from "@/model/climate/gcm/checkpoint"
import type { GcmDownscaleGrid } from "@/model/climate/gcm/downscale/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_PREPARATION } from "@/model/climate/gcm/preparation"
import { GCM_RUNNER } from "@/model/climate/gcm/runner"
import type {
	GcmAverageUpdate,
	GcmEngine,
	GcmResolution,
	GcmRun,
} from "@/model/climate/gcm/runner/types"
import { GCM_TERRAIN } from "@/model/climate/gcm/terrain"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"
import type { GcmConfig, GcmSnapshot } from "@/model/climate/gcm/types"
import { GCM_LIVE } from "@/ui/gcm/live-store"
import type {
	GcmDownload,
	GcmLaunchRequest,
	GcmRunState,
	GcmStepSample,
} from "@/ui/gcm/types"
import { loadEarthRealElevation } from "@/ui/genesis/generation/earth-assets"
import {
	type CoastlineLineData,
	loadCoastlineLines,
} from "@/ui/genesis/shared/coastline-lines"

// 4 steps = 3 model hours at the 45-minute timestep: smooth animation
// while costing one gather per four steps.
const PUBLISH_EVERY_STEPS = 4
const RATE_WINDOW_MS = 2000
// React's development profiler records a performance measure per changed
// render and never evicts them; clearing keeps long runs from growing memory.
const DEV_MEASURE_CLEAR_MS = 10_000
// Cap display-grid work at 720 × 360; retain smaller input rasters.
const DISPLAY_HEIGHT = 360

const IDLE: GcmRunState = {
	status: "idle",
	message: "Ready",
	device: "",
	truncation: 0,
	stepsPerSecond: 0,
}

function download({ name, bytes }: GcmDownload) {
	const url = URL.createObjectURL(new Blob([bytes]))
	const link = document.createElement("a")
	link.href = url
	link.download = name
	link.click()
	URL.revokeObjectURL(url)
}

export function useGcmRun() {
	const [config, setConfig] = useState<GcmConfig>(GCM.DEFAULT_CONFIG)
	const [state, setState] = useState<GcmRunState>(IDLE)
	const [resolutions, setResolutions] = useState<GcmResolution[]>([])
	const [requestedWorkers, setWorkerChoice] = useState("auto")
	const availableRanks =
		resolutions.find(
			(entry) =>
				entry.truncation === config.truncation &&
				entry.layers === config.layers,
		)?.cpu?.ranks ?? []
	const workerChoice = availableRanks.includes(Number(requestedWorkers))
		? requestedWorkers
		: "auto"
	const workerOptions = [
		{ value: "auto", label: "Auto" },
		...availableRanks.map((ranks) => ({
			value: String(ranks),
			label: String(ranks),
		})),
	]
	// GPU unless this browser has no WebGPU adapter (null while checking).
	const [engine, setEngine] = useState<GcmEngine>("gpu")
	const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
	const [downscale, setDownscale] = useState<GcmDownscaleGrid | null>(null)
	const [live] = useState(GCM_LIVE.create)
	const averager = useRef(GCM_AVERAGES.create())
	const activeConfig = useRef(config)
	const [earthCoastlines, setEarthCoastlines] =
		useState<CoastlineLineData | null>(null)
	const elevation = useRef<Promise<GcmTerrain> | null>(null)
	const [terrain, setTerrain] = useState<GcmTerrain | null>(null)
	const [earthTerrain, setEarthTerrain] = useState<GcmTerrain | null>(null)
	const coastlines = useMemo(
		() => (terrain ? GCM_TERRAIN.coastlines(terrain) : earthCoastlines),
		[terrain, earthCoastlines],
	)
	const run = useRef<GcmRun | null>(null)
	const preparation = useRef<AbortController | null>(null)
	const generation = useRef(0)
	const rate = useRef<GcmStepSample | null>(null)

	useEffect(() => {
		elevation.current ??= loadEarthRealElevation().then((raster) =>
			GCM_TERRAIN.fromEarth({ elevation: raster, scale: raster.scale }),
		)
		void elevation.current.then(setEarthTerrain, () => setEarthTerrain(null))
		void loadCoastlineLines().then(setEarthCoastlines, () =>
			setEarthCoastlines(null),
		)
		GCM_RUNNER.resolutions().then(
			(available) => setResolutions(available),
			(error: unknown) =>
				setState({ ...IDLE, status: "failed", message: String(error) }),
		)
		void GCM_RUNNER.gpuAvailable().then((available) => {
			setGpuAvailable(available)
			if (!available) setEngine("cpu")
		})
		const clearMeasures = import.meta.env.DEV
			? setInterval(() => performance.clearMeasures(), DEV_MEASURE_CLEAR_MS)
			: undefined
		return () => {
			generation.current++
			preparation.current?.abort()
			run.current?.stop()
			clearInterval(clearMeasures)
		}
	}, [])

	const onSnapshot = useCallback(
		(next: GcmSnapshot) => {
			const now = performance.now()
			const previous = rate.current
			if (!previous) rate.current = { step: next.step, time: now }
			else if (now - previous.time >= RATE_WINDOW_MS) {
				const stepsPerSecond =
					((next.step - previous.step) * 1000) / (now - previous.time)
				rate.current = { step: next.step, time: now }
				setState((current) => ({ ...current, stepsPerSecond }))
			}
			live.update({ snapshot: next })
		},
		[live],
	)

	// The worker averages every snapshot; the page mirrors the closed months.
	const onAverages = useCallback(
		({ months, years }: GcmAverageUpdate) => {
			averager.current = { current: null, months, years }
			live.update({
				averages: GCM_AVERAGES.view({
					averager: averager.current,
					config: activeConfig.current,
				}),
			})
		},
		[live],
	)

	const launch = useCallback(
		async (request: GcmLaunchRequest) => {
			activeConfig.current = request.config
			const currentGeneration = ++generation.current
			preparation.current?.abort()
			const controller = new AbortController()
			preparation.current = controller
			run.current?.stop()
			run.current = null
			rate.current = null
			if (request.fresh) {
				averager.current =
					request.diagnostics?.averager ?? GCM_AVERAGES.create()
				live.update(
					request.diagnostics
						? {
								snapshot: request.diagnostics.snapshot,
								averages:
									request.averages ??
									GCM_AVERAGES.view({
										averager: averager.current,
										config: request.config,
									}),
							}
						: GCM_LIVE.EMPTY,
				)
			}
			setState((current) => ({
				...current,
				status: "loading",
				message: request.restart ? "Resuming from checkpoint" : "Loading",
				stepsPerSecond: 0,
			}))
			try {
				const [raster, available] = await Promise.all([
					request.terrain ?? elevation.current,
					GCM_RUNNER.resolutions(),
				])
				if (!raster)
					throw new Error("Unable to load the Earth elevation raster")
				if (currentGeneration !== generation.current) return
				const resolution = available.find(
					(entry) =>
						entry.truncation === request.config.truncation &&
						entry.layers === request.config.layers,
				)
				if (!resolution?.[request.engine]) {
					throw new Error(
						`T${request.config.truncation} is not built for the ${request.engine.toUpperCase()} engine`,
					)
				}
				setState((current) => ({
					...current,
					truncation: resolution.truncation,
				}))
				const prepared = await GCM_PREPARATION.run({
					kind: "downscale",
					signal: controller.signal,
					input: {
						grid: GCM_GRID.forLatitudes(resolution.latitudes),
						terrain: raster,
						factor: Math.max(1, Math.ceil(raster.height / DISPLAY_HEIGHT)),
					},
				})
				if (currentGeneration !== generation.current) return
				setDownscale(prepared)
				run.current = GCM_RUNNER.start({
					engine: request.engine,
					config: request.config,
					terrain: raster,
					resolution,
					ranks: workerChoice === "auto" ? null : Number(workerChoice),
					publishEvery: PUBLISH_EVERY_STEPS,
					restart: request.restart,
					averager: request.diagnostics?.averager ?? null,
					startPaused: request.paused,
					onSnapshot: (snapshot) => {
						if (currentGeneration === generation.current) onSnapshot(snapshot)
					},
					onAverages: (update) => {
						if (currentGeneration === generation.current) onAverages(update)
					},
					onStatus: ({ status, message }) => {
						if (currentGeneration === generation.current)
							setState((current) => ({ ...current, status, message }))
					},
					onDevice: (device) => {
						if (currentGeneration === generation.current)
							setState((current) => ({ ...current, device }))
					},
					onCheckpoint: ({ restart, averager: saved }) => {
						if (currentGeneration !== generation.current) return
						const latest = live.get().snapshot
						if (latest) {
							const meta = {
								format: GCM_CHECKPOINT.FORMATS[request.engine],
								config: request.config,
								precisionBytes:
									request.engine === "gpu"
										? GCM_CHECKPOINT.GPU_PRECISION_BYTES
										: (resolution.cpu?.precisionBytes ?? 0),
								date: latest.date,
								step: latest.step,
							}
							download({
								name: GCM_CHECKPOINT.fileName(meta),
								bytes: GCM_CHECKPOINT.encode({
									terrain: raster,
									meta,
									restart,
									diagnostics: {
										averager: saved,
										snapshot: latest,
									},
								}),
							})
						}
					},
				})
			} catch (error) {
				if (currentGeneration !== generation.current) return
				setState({
					...IDLE,
					status: "failed",
					message: error instanceof Error ? error.message : String(error),
				})
			}
		},
		[live, onSnapshot, onAverages, workerChoice],
	)

	const loadFromFile = useCallback(
		async (file: File) => {
			const currentGeneration = ++generation.current
			preparation.current?.abort()
			const controller = new AbortController()
			preparation.current = controller
			run.current?.stop()
			run.current = null
			rate.current = null
			setState({ ...IDLE, status: "loading", message: "Reading checkpoint" })
			try {
				const { checkpoint, averages } = await GCM_PREPARATION.run({
					kind: "checkpoint",
					input: file,
					signal: controller.signal,
				})
				const { meta, restart, diagnostics, terrain } = checkpoint
				if (currentGeneration !== generation.current) return
				const saved = GCM_CHECKPOINT.engine(meta)
				if (saved === "gpu" && !gpuAvailable)
					throw new Error(
						"This checkpoint was saved by the GPU engine, and this browser has no WebGPU",
					)
				const build = resolutions.find(
					(entry) =>
						entry.truncation === meta.config.truncation &&
						entry.layers === meta.config.layers,
				)?.cpu
				if (
					saved === "cpu" &&
					build &&
					build.precisionBytes !== meta.precisionBytes
				) {
					throw new Error(
						`Checkpoint uses ${meta.precisionBytes}-byte reals; this T${meta.config.truncation} CPU build uses ${build.precisionBytes}`,
					)
				}
				setConfig(meta.config)
				setTerrain(terrain)
				setEngine(saved)
				await launch({
					engine: saved,
					terrain,
					config: meta.config,
					restart,
					fresh: true,
					paused: true,
					diagnostics,
					averages,
				})
			} catch (error) {
				if (currentGeneration !== generation.current) return
				setState({
					...IDLE,
					status: "failed",
					message: error instanceof Error ? error.message : String(error),
				})
			}
		},
		[launch, gpuAvailable, resolutions],
	)

	const clear = () => {
		generation.current++
		preparation.current?.abort()
		run.current?.stop()
		run.current = null
		rate.current = null
		averager.current = GCM_AVERAGES.create()
		live.update(GCM_LIVE.EMPTY)
		setDownscale(null)
		setState(IDLE)
	}

	return {
		terrain,
		displayTerrain: terrain ?? earthTerrain,
		setTerrain: (next: GcmTerrain | null) => {
			clear()
			setTerrain(next)
			setConfig((current) => ({
				...current,
				earthSurfaceClimatology: next === null,
			}))
		},
		config,
		setConfig: (next: GcmConfig) =>
			setConfig((current) =>
				next.truncation === 63 && current.truncation !== 63
					? { ...next, timestepMinutes: Math.min(next.timestepMinutes, 20) }
					: next,
			),
		state,
		resolutions,
		workerChoice,
		workerOptions,
		setWorkerChoice,
		downscale,
		live,
		coastlines,
		engine,
		setEngine: (next: GcmEngine) => {
			if (next === "cpu" && config.truncation === 63) {
				const fallback = resolutions.find(
					(entry) => entry.layers === config.layers && entry.cpu,
				)
				if (fallback) setConfig({ ...config, truncation: fallback.truncation })
			}
			setEngine(next)
		},
		gpuAvailable,
		start: () =>
			launch({
				terrain,
				engine,
				config,
				restart: null,
				fresh: true,
				paused: false,
				diagnostics: null,
				averages: null,
			}),
		load: loadFromFile,
		clear,
		pause: () => run.current?.pause(),
		resume: () => run.current?.resume(),
		save: () => run.current?.checkpoint(),
	}
}
