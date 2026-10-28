import type {
	GcmKeplerRequest,
	GcmSolarPosition,
	GcmSolarRequest,
} from "@/model/climate/gcm/calendar/solar/types"

const PI = 3.14159265359
const TWOPI = PI + PI
const NEWTON_TOLERANCE = 1e-14
const DERIVATIVE_FLOOR = 1e-15
const NEWTON_ITERATIONS = 101

function eccentricAnomaly({ mean, eccentricity }: GcmKeplerRequest): number {
	let value = eccentricity < 0.5 ? mean : PI
	for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration++) {
		const previous = value
		value -=
			(value - (mean + eccentricity * Math.sin(value))) /
			Math.max(DERIVATIVE_FLOOR, 1 - eccentricity * Math.cos(value))
		if (Math.abs(value - previous) <= NEWTON_TOLERANCE) break
	}
	return value
}

function position({
	step,
	stepsPerYear,
	stepsPerDay,
	stepMinutes,
	orbit,
	keplerian,
	synchronous,
}: GcmSolarRequest): GcmSolarPosition {
	const calendarDay = (step % stepsPerYear) / stepsPerYear
	const minutes = Math.trunc((step % stepsPerDay) * stepMinutes)
	const {
		eccentricity: e,
		obliquityRad,
		perihelionLongitudeRad,
		meanLongitudeAtEquinoxRad,
	} = orbit
	let longitude: number
	let trueAnomaly: number
	let distanceFactor: number
	if (keplerian) {
		trueAnomaly = 0
		distanceFactor = 1
		if (!synchronous) {
			let mean = calendarDay * TWOPI + orbit.meanAnomalyRad
			while (mean > TWOPI) mean -= TWOPI
			while (mean < 0) mean += TWOPI
			if (e > 0) {
				const anomaly = eccentricAnomaly({ mean, eccentricity: e })
				const tangent = Math.tan(anomaly * 0.5)
				const magnitude = Math.sqrt(((1 + e) / (1 - e)) * tangent * tangent)
				trueAnomaly = 2 * Math.atan(tangent < 0 ? -magnitude : magnitude)
				if (trueAnomaly < 0) trueAnomaly += TWOPI
				trueAnomaly %= TWOPI
				const inverseDistance = 1 / (1 - e * Math.cos(anomaly))
				distanceFactor = inverseDistance * inverseDistance
			} else trueAnomaly = mean
		}
		longitude = (perihelionLongitudeRad + trueAnomaly) % TWOPI
	} else {
		const meanLongitude =
			meanLongitudeAtEquinoxRad + (calendarDay - 80.5 / 365) * 2 * Math.PI
		const anomaly = meanLongitude - perihelionLongitudeRad
		const sine = Math.sin(anomaly)
		longitude =
			meanLongitude +
			e *
				(2 * sine +
					e *
						(1.25 * Math.sin(2 * anomaly) +
							e * ((13 / 12) * Math.sin(3 * anomaly) - 0.25 * sine)))
		const inverseDistance =
			(1 + e * Math.cos(longitude - perihelionLongitudeRad)) / (1 - e * e)
		distanceFactor = inverseDistance * inverseDistance
		trueAnomaly = (longitude - perihelionLongitudeRad) % (2 * Math.PI)
	}
	return {
		calendarDay,
		minutes,
		declination: Math.asin(Math.sin(obliquityRad) * Math.sin(longitude)),
		distanceFactor,
		trueAnomaly,
		longitude,
		rightAscension: Math.atan2(
			Math.cos(obliquityRad) * Math.sin(longitude),
			Math.cos(longitude),
		),
	}
}

export const SOLAR = { position }
