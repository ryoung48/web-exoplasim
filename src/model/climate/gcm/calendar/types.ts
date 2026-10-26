// orb_params' output, fixed for a run: radini calls it once.
export interface GcmOrbit {
	eccentricity: number
	obliquityRad: number
	perihelionLongitudeRad: number
	meanLongitudeAtEquinoxRad: number
}

export interface GcmSolarRequest {
	step: number
	stepsPerYear: number
	stepsPerDay: number
	stepMinutes: number
	orbit: GcmOrbit
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
