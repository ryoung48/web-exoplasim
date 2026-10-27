// orb_params' output, fixed for a run: radini calls it once.
export interface GcmOrbit {
	eccentricity: number
	obliquityRad: number
	perihelionLongitudeRad: number
	meanLongitudeAtEquinoxRad: number
}

// orb_params' inputs: planet_nl's orbit, used as given when fixed
// (nfixorb = 1), otherwise replaced by Berger's values for the year.
export interface GcmOrbitRequest {
	fixed: boolean
	eccentricity: number
	obliquityDeg: number
	perihelionDeg: number
	meanAnomalyDeg: number
	// radini's iyrad = 1950 − iyrbp, the year AD the Berger series is for.
	year: number
}

export interface GcmOrbitParameters extends GcmOrbit {
	obliquityDeg: number
	perihelionDeg: number
	meanAnomalyRad: number
}

// One of orb_params' sums Σ amplitude·wave((rate·years + phase)°).
export interface GcmBergerSeries {
	amplitudes: number[]
	rates: number[]
	phases: number[]
	years: number
	wave: (radians: number) => number
}

export interface GcmSolarRequest {
	step: number
	stepsPerYear: number
	stepsPerDay: number
	stepMinutes: number
	orbit: GcmOrbit
}

// step2cal30's inputs (stepMinutes as calini receives it, see below).
export interface GcmDateRequest {
	step: number
	stepsPerDay: number
	daysPerYear: number
	stepMinutes: number
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
