import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"

export interface GcmTerrainCellRequest {
	terrain: GcmTerrain
	north: number
	south: number
	west: number
	east: number
}

export interface GcmTerrainCell {
	landFraction: number
	elevationM: number
}
