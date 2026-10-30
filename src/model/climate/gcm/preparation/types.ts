import type { GcmAverageState } from "@/model/climate/gcm/averages/types"
import type { GcmBoundaryRequest } from "@/model/climate/gcm/boundary/types"
import type { GcmCheckpoint } from "@/model/climate/gcm/checkpoint/types"
import type { GcmClassificationRequest } from "@/model/climate/gcm/classification/types"
import type {
	GcmDownscaleGrid,
	GcmDownscaleRequest,
} from "@/model/climate/gcm/downscale/types"

export interface GcmPreparationInputs {
	checkpoint: File
	boundary: GcmBoundaryRequest
	downscale: GcmDownscaleRequest
	classification: GcmClassificationRequest
}

export interface GcmPreparationResults {
	checkpoint: GcmPreparedCheckpoint
	boundary: Record<string, string>
	downscale: GcmDownscaleGrid
	classification: Uint8Array | null
}

export interface GcmPreparedCheckpoint {
	checkpoint: GcmCheckpoint
	averages: GcmAverageState
}

export type GcmPreparationKind = keyof GcmPreparationInputs

export interface GcmPreparationRequest<Kind extends GcmPreparationKind> {
	kind: Kind
	input: GcmPreparationInputs[Kind]
	signal: AbortSignal
}

export type GcmPreparationMessage = {
	[Kind in GcmPreparationKind]: {
		kind: Kind
		input: GcmPreparationInputs[Kind]
	}
}[GcmPreparationKind]

export type GcmPreparationResponse =
	| { type: "prepared"; result: GcmPreparationResults[GcmPreparationKind] }
	| { type: "failed"; message: string }
