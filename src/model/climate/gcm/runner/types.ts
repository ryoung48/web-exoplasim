import type {
	GcmAverager,
	GcmMonthlyMean,
} from "@/model/climate/gcm/averages/types"
import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import type {
	GcmBatchTiming,
	GcmStepCalendar,
} from "@/model/climate/gcm/stepper/types"
import type {
	GcmConfig,
	GcmElevationRaster,
	GcmSnapshot,
	GcmTruncation,
} from "@/model/climate/gcm/types"

// The worker's model inputs: every namelist and .sra file by name, as
// SETUP reads them, and the WebGPU state to continue from (or none).
export interface GcmWorkerStart {
	type: "start"
	truncation: GcmTruncation
	files: Record<string, string>
	restart: ArrayBuffer | null
	// The averages saved with the restart; null for a fresh start.
	averager: GcmAverager | null
	publishEvery: number
	startPaused: boolean
}

// The means the page shows: the last 12 closed months and every year's
// balance, sent when a month closes.
export interface GcmAverageUpdate {
	months: GcmMonthlyMean[]
	years: GcmYearlyBalance[]
}

export interface GcmRunCheckpoint {
	restart: ArrayBuffer
	averager: GcmAverager
}

export type GcmWorkerRequest =
	| GcmWorkerStart
	| { type: "pause" }
	| { type: "resume" }
	| { type: "checkpoint" }
	| { type: "stop" }

export type GcmWorkerResponse =
	| { type: "loaded"; device: string }
	| {
			type: "progress"
			latest: GcmSnapshot
			averages: GcmAverageUpdate | null
	  }
	| { type: "checkpoint"; restart: ArrayBuffer; averager: GcmAverager }
	| { type: "error"; message: string }

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
	config: GcmConfig
	elevation: GcmElevationRaster
	resolution: GcmResolution
	publishEvery: number
	restart: ArrayBuffer | null
	// The averages saved with the restart; null for a fresh start.
	averager: GcmAverager | null
	startPaused: boolean
	onSnapshot(snapshot: GcmSnapshot): void
	onAverages(update: GcmAverageUpdate): void
	onStatus(update: GcmStatusUpdate): void
	onDevice(description: string): void
	onCheckpoint(saved: GcmRunCheckpoint): void
}

export interface GcmRun {
	pause(): void
	resume(): void
	checkpoint(): void
	stop(): void
}

export interface GcmResolution {
	truncation: GcmTruncation
	latitudes: number
	// public/gcm-relative path of the resolution's inputs.json.
	inputs: string
	downloadBytes: number
}

export interface GcmManifest {
	resolutions: GcmResolution[]
}

export interface GcmInputs {
	files: Record<string, string>
}

// What the worker holds once set up: the device and state, the main loop's
// kernels, the parameter buffer and staging ring, and the run's calendar.
export interface GcmWorkerModel {
	device: GPUDevice
	context: GcmKernelContext
	kernels: GcmKernel[]
	pack: GcmKernel
	params: GPUBuffer
	staging: GPUBuffer[]
	calendar: GcmStepCalendar
	publishEvery: number
	// GPU timestamps per batch, or null without timestamp-query.
	timing: GcmBatchTiming | null
}

export interface GcmWorkerPost {
	response: GcmWorkerResponse
	transfer: Transferable[]
}

export interface GcmStateWrite {
	name: string
	values: ArrayLike<number>
}
