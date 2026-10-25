import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmElevationRaster } from "@/model/climate/gcm/types"

export interface GcmBoundary {
	grid: GcmGrid
	landFraction: Float64Array
	geopotential: Float64Array
}

export interface GcmBoundaryRequest {
	grid: GcmGrid
	elevation: GcmElevationRaster
}

export interface GcmRowLookup {
	grid: GcmGrid
	latitude: number
}

export interface GcmSraField {
	grid: GcmGrid
	code: number
	values: Float64Array
}
