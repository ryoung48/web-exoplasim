import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import type { GcmStepCalendar } from "@/model/climate/gcm/stepper/types"
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
	publishEvery: number
	startPaused: boolean
}

export type GcmWorkerRequest =
	| GcmWorkerStart
	| { type: "pause" }
	| { type: "resume" }
	| { type: "ack" }
	| { type: "checkpoint" }
	| { type: "stop" }

export type GcmWorkerResponse =
	| { type: "loaded"; device: string }
	| { type: "snapshots"; snapshots: GcmSnapshot[] }
	| { type: "checkpoint"; restart: ArrayBuffer }
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
	startPaused: boolean
	onSnapshot(snapshot: GcmSnapshot): void
	onStatus(update: GcmStatusUpdate): void
	onDevice(description: string): void
	onCheckpoint(restart: ArrayBuffer): void
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
}

export interface GcmWorkerPost {
	response: GcmWorkerResponse
	transfer: Transferable[]
}

export interface GcmStateWrite {
	name: string
	values: ArrayLike<number>
}
