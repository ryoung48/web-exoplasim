import type {
	GcmMonthInterpolation,
	GcmMonthRequest,
	GcmSolarPosition,
	GcmSolarRequest,
} from "@/model/climate/gcm/calendar/types"

// orb_decl's calendar day of the vernal equinox.
const VERNAL_EQUINOX_DAY = 80.5
const DAYS_PER_YEAR = 365

// radmod's solang and orb_decl, in f64. Every page configuration has
// nperpetual = 0, ngenkeplerian = 0, nfixed = 0 and slowdown = 1; only that
// path is ported.
function solar({
	step,
	stepsPerYear,
	stepsPerDay,
	stepMinutes,
	orbit,
}: GcmSolarRequest): GcmSolarPosition {
	const calendarDay = (step % stepsPerYear) / stepsPerYear
	const minutes = Math.trunc(
		((step % stepsPerDay) * stepMinutes * stepsPerDay) / stepsPerDay,
	)
	const {
		eccentricity: e,
		obliquityRad,
		perihelionLongitudeRad,
		meanLongitudeAtEquinoxRad,
	} = orbit
	const meanLongitude =
		meanLongitudeAtEquinoxRad +
		(calendarDay - VERNAL_EQUINOX_DAY / DAYS_PER_YEAR) * 2 * Math.PI
	const anomaly = meanLongitude - perihelionLongitudeRad
	const sine = Math.sin(anomaly)
	const longitude =
		meanLongitude +
		e *
			(2 * sine +
				e *
					(1.25 * Math.sin(2 * anomaly) +
						e * ((13 / 12) * Math.sin(3 * anomaly) - 0.25 * sine)))
	const inverseDistance =
		(1 + e * Math.cos(longitude - perihelionLongitudeRad)) / (1 - e * e)
	return {
		calendarDay,
		minutes,
		declination: Math.asin(Math.sin(obliquityRad) * Math.sin(longitude)),
		distanceFactor: inverseDistance * inverseDistance,
		trueAnomaly: (longitude - perihelionLongitudeRad) % (2 * Math.PI),
		longitude,
		rightAscension: Math.atan2(
			Math.cos(obliquityRad) * Math.sin(longitude),
			Math.cos(longitude),
		),
	}
}

// momint's month index runs 0–13: the climatologies repeat December and
// January around the year.
const CLIMATOLOGY_MONTHS = 14
// calmod's simple calendar: 360 days of 30 days a month.
const CALENDAR_DAYS_PER_YEAR = 360
const CALENDAR_DAYS_PER_MONTH = 30
const SECONDS_PER_MINUTE = 60

// calmod's momint with step2cal30 (nperpetual = 0; n_days_per_year = 365
// would take the Gregorian step2cal, which no page configuration uses).
function monthInterpolation({
	step,
	stepsPerDay,
	daysPerYear,
	daysPerMonth,
	stepMinutes,
	solarDay,
}: GcmMonthRequest): GcmMonthInterpolation {
	if (daysPerYear === 365)
		throw new Error("The 365-day calendar (step2cal) is not ported")
	const mtspd = Math.trunc((daysPerYear * stepsPerDay) / CALENDAR_DAYS_PER_YEAR)
	const tcalday = mtspd * Math.round(stepMinutes) * SECONDS_PER_MINUTE
	const dayOfYear = Math.trunc(step / mtspd) % CALENDAR_DAYS_PER_YEAR
	const month = Math.trunc(dayOfYear / CALENDAR_DAYS_PER_MONTH) + 1
	const day = (dayOfYear % CALENDAR_DAYS_PER_MONTH) + 1
	const minutes = Math.trunc(
		((step % mtspd) * tcalday) / (mtspd * SECONDS_PER_MINUTE),
	)
	const hour = Math.trunc(minutes / 60)
	const fractionalDay =
		day + ((hour * 60 + (minutes % 60)) * SECONDS_PER_MINUTE) / solarDay
	const median = 0.5 * (daysPerMonth + 1)
	return {
		month,
		neighbour: fractionalDay > median ? month + 1 : month - 1,
		weight: Math.abs(fractionalDay - median) / (median + median - 1),
	}
}

export const CALENDAR = {
	CLIMATOLOGY_MONTHS,
	solar,
	monthInterpolation,
}
