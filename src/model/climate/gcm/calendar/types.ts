// orb_params' output, fixed for a run: radini calls it once.
export interface GcmOrbit {
	eccentricity: number
	obliquityRad: number
	perihelionLongitudeRad: number
	meanAnomalyRad: number
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
}

// One of orb_params' sums Σ amplitude·wave((rate·years + phase)°).
export interface GcmBergerSeries {
	amplitudes: number[]
	rates: number[]
	phases: number[]
	years: number
	wave: (radians: number) => number
}

// step2cal30's inputs (stepMinutes as calini receives it, see below).
// momint's interpolation between month a (1–12) and its nearer neighbour
// b (0–13), b weighted by weight.
// solang's per-step values under their radmod names: zcdayf, zmins,
// zdeclf, eccf (gdist2), orbnu, lambm and rasc.
