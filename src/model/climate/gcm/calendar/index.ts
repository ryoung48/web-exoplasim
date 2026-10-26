import type {
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

export const CALENDAR = {
	solar,
}
