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

export interface GcmMonthRequest {
	step: number
	stepsPerDay: number
	daysPerYear: number
	daysPerMonth: number
	// nint(mpstep): upstream plasim passes mcal_days_per_year in calini's
	// mpstep argument; model_source.py's calendar fix passes this.
	stepMinutes: number
	solarDay: number
}

// momint's interpolation between month a (1–12) and its nearer neighbour
// b (0–13), b weighted by weight.
export interface GcmMonthInterpolation {
	month: number
	neighbour: number
	weight: number
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
