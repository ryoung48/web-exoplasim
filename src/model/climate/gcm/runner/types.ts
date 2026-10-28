import type {
	GcmAverager,
	GcmMonthlyMean,
} from "@/model/climate/gcm/averages/types"
import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"
import type {
	GcmConfig,
	GcmLayerCount,
	GcmSnapshot,
	GcmTruncation,
} from "@/model/climate/gcm/types"

// The model's two implementations: the WebGPU port, or ExoPlaSim compiled
// to WebAssembly on CPU workers.
export type GcmEngine = "gpu" | "cpu"

// The means the page shows: the last 12 closed months and every year's
// balance, sent when a month closes.
export interface GcmAverageUpdate {
	months: GcmMonthlyMean[]
	years: GcmYearlyBalance[]
}

// A saved run: the engine's restart data and the averages at that point.
export interface GcmRunCheckpoint {
	restart: ArrayBuffer
	averager: GcmAverager
}

export type GcmRunStatus =
	| "loading"
	| "running"
	| "paused"
	| "checkpointing"
	| "finished"
	| "failed"

export interface GcmStatusUpdate {
	status: GcmRunStatus
	message: string
}

export interface GcmRunRequest {
	engine: GcmEngine
	ranks: number | null
	config: GcmConfig
	terrain: GcmTerrain
	resolution: GcmResolution
	publishEvery: number
	restart: ArrayBuffer | null
	// The averages saved with the restart; null for a fresh start.
	averager: GcmAverager | null
	startPaused: boolean
	onSnapshot(snapshot: GcmSnapshot): void
	onAverages(update: GcmAverageUpdate): void
	onStatus(update: GcmStatusUpdate): void
	// What runs the model: the GPU's name, or the number of CPU workers.
	onDevice(description: string): void
	onCheckpoint(saved: GcmRunCheckpoint): void
}

export interface GcmRun {
	pause(): void
	resume(): void
	checkpoint(): void
	stop(): void
}

// The Wasm build of a resolution (public/gcm/manifest.json).
export interface GcmCpuBuild {
	precisionBytes: number
	ranks: number[]
	downloadBytes: number
}

// The WebGPU model's inputs for a resolution (public/gcm/webgpu.json).
export interface GcmGpuInputs {
	// public/gcm-relative path of the resolution's inputs.json.
	inputs: string
	downloadBytes: number
}

// A resolution and what each engine needs to run it; null where that
// engine's assets are not built.
export interface GcmResolution {
	layers: GcmLayerCount
	truncation: GcmTruncation
	latitudes: number
	cpu: GcmCpuBuild | null
	gpu: GcmGpuInputs | null
}
