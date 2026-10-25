import type { GcmElevationRaster } from "@/model/climate/gcm/types"

export interface GcmTerrainDimensions {
	width: number
	height: number
}

export interface GcmTerrain extends GcmTerrainDimensions {
	name: string
	elevationM: Float32Array
	land: Float32Array
}

export interface GcmEarthTerrainInput {
	elevation: GcmElevationRaster
	scale: number
}

export interface GcmTerrainSummary {
	minM: number
	maxM: number
	landPercent: number
}

export interface GcmTerrainCoastlines {
	rings: number[][]
}
