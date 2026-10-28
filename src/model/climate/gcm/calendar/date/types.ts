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

export interface GcmStartStepRequest {
	mtspd: number
	year: number
	month: number
	daysPerYear: number
	daysPerMonth: number
}
export interface GcmCalendarMonth {
	year: number
	month: number
}
