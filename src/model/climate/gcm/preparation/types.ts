import type { GcmBoundaryRequest } from "@/model/climate/gcm/boundary/types"
import type {
	GcmDownscaleGrid,
	GcmDownscaleRequest,
} from "@/model/climate/gcm/downscale/types"

export interface GcmPreparationInputs {
	boundary: GcmBoundaryRequest
	downscale: GcmDownscaleRequest
}

export interface GcmPreparationResults {
	boundary: Record<string, string>
	downscale: GcmDownscaleGrid
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
