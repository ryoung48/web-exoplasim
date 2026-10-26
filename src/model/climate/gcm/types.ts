import type { GcmAtmosphereConfig } from "@/model/climate/gcm/atmosphere/types"

export type GcmPhysicsFilter = "gp" | "sp" | "none" | "cesaro" | "exp" | "lh"

export type GcmVegetation = 0 | 1 | 2

export type GcmLayerCount = 5 | 10

export type GcmTruncation = 21 | 42

export type GcmAlbedoKey = "landAlbedo" | "oceanAlbedo" | "snowIceAlbedo"

export type GcmSurfaceOverrideKey =
	| GcmAlbedoKey
	| "soilWaterCapacityM"
	| "soilHeatCapacity"

export type GcmOrbitOverrideKey =
	| "periapseLongitudeDeg"
	| "initialMeanAnomalyDeg"

export interface GcmGlaciers {
	enabled: boolean
	minDepthM: number
	initialHeightM: number
}

export interface GcmConfig {
	atmosphere: GcmAtmosphereConfig
	layers: GcmLayerCount
	periapseLongitudeDeg: number | null
	keplerian: boolean
	initialMeanAnomalyDeg: number | null
	soilWaterCapacityM: number | null
	soilHeatCapacity: number | null
	soilDepthScale: number
	landAlbedo: number | null
	oceanAlbedo: number | null
	snowIceAlbedo: number | null
	radiusEarth: number
	gravityMs2: number
	synchronous: boolean
	substellarLongitudeDeg: number
	oceanDepthM: number
	fluxWm2: number
	starTemperatureK: number
	yearDays: number
	eccentricity: number
	rotationPeriodDays: number
	obliquityDeg: number
	fixedOrbit: boolean
	wetSoil: boolean
	vegetation: GcmVegetation
	initialGrowth: number
	glaciers: GcmGlaciers
	physicsFilter: ReadonlyArray<GcmPhysicsFilter>
	timestepMinutes: number
	radiationIntervalSteps: number
	truncation: GcmTruncation
	earthSurfaceClimatology: boolean
}

export interface GcmDate {
	year: number
	month: number
	day: number
	hour: number
	minute: number
}

export interface GcmSnapshot {
	layers: GcmLayerCount
	step: number
	date: GcmDate
	values: Float32Array
}

export interface GcmElevationRaster {
	raster: Int16Array
	width: number
	height: number
	nodata: number
}
