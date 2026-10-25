export type GcmPhysicsFilter = "gp" | "sp" | "none" | "cesaro" | "exp" | "lh"

export type GcmVegetation = 0 | 1 | 2

export type GcmTruncation = 21 | 42

export interface GcmGlaciers {
	enabled: boolean
	minDepthM: number
	initialHeightM: number
}

export interface GcmConfig {
	fluxWm2: number
	starTemperatureK: number
	yearDays: number
	eccentricity: number
	rotationPeriodDays: number
	obliquityDeg: number
	fixedOrbit: boolean
	pN2Bar: number
	pO2Bar: number
	pArBar: number
	ozone: boolean
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
