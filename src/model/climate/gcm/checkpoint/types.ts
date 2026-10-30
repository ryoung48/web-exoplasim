import type { GcmAverager } from "@/model/climate/gcm/averages/types"
import type { GcmTargetState } from "@/model/climate/gcm/targeting/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"
import type { GcmConfig, GcmDate, GcmSnapshot } from "@/model/climate/gcm/types"

export interface GcmCheckpointMeta {
	format: number
	config: GcmConfig
	precisionBytes: number
	date: GcmDate
	step: number
}

export interface GcmCheckpoint {
	terrain: GcmTerrain
	meta: GcmCheckpointMeta
	restart: ArrayBuffer
	diagnostics: GcmCheckpointDiagnostics
}

export interface GcmCheckpointDiagnostics {
	targeting: GcmTargetState | null
	averager: GcmAverager
	snapshot: GcmSnapshot
}

export interface GcmCheckpointArray {
	array: "Float32Array" | "Float64Array"
	offset: number
	bytes: number
}
