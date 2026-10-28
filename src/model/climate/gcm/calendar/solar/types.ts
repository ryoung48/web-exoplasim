import { GcmOrbit } from "@/model/climate/gcm/calendar/types"

export interface GcmSolarRequest {
	keplerian: boolean
	synchronous: boolean
	step: number
	stepsPerYear: number
	stepsPerDay: number
	stepMinutes: number
	orbit: GcmOrbit
}

export interface GcmKeplerRequest {
	mean: number
	eccentricity: number
}

// solang's per-step values under their radmod names: zcdayf, zmins,
// zdeclf, eccf (gdist2), orbnu, lambm and rasc.
export interface GcmSolarPosition {
	calendarDay: number
	minutes: number
	declination: number
	distanceFactor: number
	trueAnomaly: number
	longitude: number
	rightAscension: number
}
