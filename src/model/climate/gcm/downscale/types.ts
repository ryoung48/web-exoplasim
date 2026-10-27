import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"

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
	terrain: GcmTerrain
	factor: number
}

export interface GcmDownscaleField {
	downscale: GcmDownscaleGrid
	values: Float32Array
}

export interface GcmLapseRequest {
	downscale: GcmDownscaleGrid
	temperature: Float32Array
}
