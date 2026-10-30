import type { GcmAverager } from "@/model/climate/gcm/averages/types"
import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import type {
	GcmAverageUpdate,
	GcmRunRequest,
} from "@/model/climate/gcm/runner/types"
import type {
	GcmBatchTiming,
	GcmStepCalendar,
} from "@/model/climate/gcm/stepper/types"
import type {
	GcmConfig,
	GcmLayerCount,
	GcmSnapshot,
	GcmTruncation,
} from "@/model/climate/gcm/types"

// The worker's model inputs: every namelist and .sra file by name, as
// SETUP reads them, and the WebGPU state to continue from (or none).
export interface GcmWorkerStart {
	config: GcmConfig
	previousConfig: GcmConfig | null
	restoreCo2: boolean
	layers: GcmLayerCount
	type: "start"
	truncation: GcmTruncation
	files: Record<string, string>
	restart: ArrayBuffer | null
	// The averages saved with the restart; null for a fresh start.
	averager: GcmAverager | null
	publishEvery: number
	startPaused: boolean
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

// public/gcm/webgpu.json, written by scripts/exoplasim-webgpu/package-inputs.mjs.
export interface GcmGpuManifest {
	resolutions: GcmGpuManifestEntry[]
}

export interface GcmGpuManifestEntry {
	truncation: GcmTruncation
	latitudes: number
	inputs: string
	downloadBytes: number
}

export interface GcmInputs {
	files: Record<string, string>
}

export interface GcmGpuFileRequest {
	request: GcmRunRequest
	signal: AbortSignal
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
