import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"

export interface GcmBoundary {
	grid: GcmGrid
	landFraction: Float64Array
	geopotential: Float64Array
}

export interface GcmBoundaryRequest {
	grid: GcmGrid
	terrain: GcmTerrain
}

export interface GcmSraField {
	grid: GcmGrid
	code: number
	values: Float64Array
}
