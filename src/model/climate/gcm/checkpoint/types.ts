import type { GcmAverager } from "@/model/climate/gcm/averages/types"
import type { GcmConfig, GcmDate, GcmSnapshot } from "@/model/climate/gcm/types"

export interface GcmCheckpointMeta {
	format: number
	config: GcmConfig
	precisionBytes: number
	date: GcmDate
	step: number
}

export interface GcmCheckpoint {
	meta: GcmCheckpointMeta
	restart: ArrayBuffer
	diagnostics: GcmCheckpointDiagnostics
}

export interface GcmCheckpointDiagnostics {
	averager: GcmAverager
	snapshot: GcmSnapshot
}

export interface GcmCheckpointArray {
	array: "Float32Array" | "Float64Array"
	offset: number
	bytes: number
}
