import type { GcmMonthlyMean } from "@/model/climate/gcm/averages/types"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmElevationRaster } from "@/model/climate/gcm/types"

export interface GcmDownscaleGrid {
	grid: GcmGrid
	width: number
	height: number
	elevationM: Float32Array
	land: Uint8Array
	modelElevationM: Float32Array
	cellElevationM: Float32Array
	corners: Int32Array
	weights: Float32Array
}

export interface GcmDownscaleRequest {
	grid: GcmGrid
	elevation: GcmElevationRaster
	factor: number
}

export interface GcmDownscaleField {
	downscale: GcmDownscaleGrid
	values: Float32Array
}

export interface GcmDownscaleKoppen {
	downscale: GcmDownscaleGrid
	months: ReadonlyArray<GcmMonthlyMean>
}

export interface GcmLapseRequest {
	downscale: GcmDownscaleGrid
	temperature: Float32Array
}
