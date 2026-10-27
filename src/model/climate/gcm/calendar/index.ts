import { BERGER } from "@/model/climate/gcm/calendar/berger"
import type {
	GcmBergerSeries,
	GcmMonthInterpolation,
	GcmMonthRequest,
	GcmOrbitParameters,
	GcmOrbitRequest,
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

// orb_params' constants: arcseconds to degrees, and Berger's mean
// obliquity, precession rate and phase.
const ARCSEC = 1 / 3600
const MEAN_OBLIQUITY_DEG = 23.320556
const PRECESSION_ARCSEC_PER_YEAR = 50.439273
const PRECESSION_PHASE_DEG = 3.392506
const BERGER_EPOCH = 1950

function series({
	amplitudes,
	rates,
	phases,
	years,
	wave,
}: GcmBergerSeries): number {
	const degrad = (4 * Math.atan(1)) / 180
	let sum = 0
	for (let i = 0; i < amplitudes.length; i++)
		sum =
			sum +
			amplitudes[i] * wave((rates[i] * ARCSEC * years + phases[i]) * degrad)
	return sum
}

// radmod's orb_params: the orbit at set-up, as given or from Berger
// (1978), and the perihelion and mean longitude orb_decl uses each step.
function orbit({
	fixed,
	eccentricity,
	obliquityDeg,
	perihelionDeg,
	meanAnomalyDeg,
	year,
}: GcmOrbitRequest): GcmOrbitParameters {
	const pi = 4 * Math.atan(1)
	const degrad = pi / 180
	let eccen = eccentricity
	let obliq = obliquityDeg
	let mvelp = perihelionDeg
	if (!fixed) {
		const years = -(BERGER_EPOCH - year)
		const {
			obamp,
			obrate,
			obphas,
			ecamp,
			ecrate,
			ecphas,
			mvamp,
			mvrate,
			mvphas,
		} = BERGER
		obliq =
			MEAN_OBLIQUITY_DEG +
			series({
				amplitudes: obamp.map((a) => a * ARCSEC),
				rates: obrate,
				phases: obphas,
				years,
				wave: Math.cos,
			})
		const cossum = series({
			amplitudes: ecamp,
			rates: ecrate,
			phases: ecphas,
			years,
			wave: Math.cos,
		})
		const sinsum = series({
			amplitudes: ecamp,
			rates: ecrate,
			phases: ecphas,
			years,
			wave: Math.sin,
		})
		eccen = Math.sqrt(cossum * cossum + sinsum * sinsum)
		let fvelp = 0
		if (Math.abs(cossum) <= 1e-8) {
			fvelp = sinsum === 0 ? 0 : sinsum < 0 ? 1.5 * pi : 0.5 * pi
		} else if (cossum < 0) {
			fvelp = Math.atan(sinsum / cossum) + pi
		} else {
			fvelp = Math.atan(sinsum / cossum) + (sinsum < 0 ? 2 * pi : 0)
		}
		const mvsum = series({
			amplitudes: mvamp.map((a) => a * ARCSEC),
			rates: mvrate,
			phases: mvphas,
			years,
			wave: Math.sin,
		})
		mvelp =
			fvelp / degrad +
			PRECESSION_ARCSEC_PER_YEAR * ARCSEC * years +
			PRECESSION_PHASE_DEG +
			mvsum
		while (mvelp < 0) mvelp = mvelp + 360
		while (mvelp >= 360) mvelp = mvelp - 360
	}
	const eccen2 = eccen * eccen
	const eccen3 = eccen2 * eccen
	const mvelpp = (mvelp + 180) * degrad
	const beta = Math.sqrt(1 - eccen2)
	return {
		eccentricity: eccen,
		obliquityDeg: obliq,
		perihelionDeg: mvelp,
		obliquityRad: obliq * degrad,
		meanAnomalyRad: meanAnomalyDeg * degrad,
		perihelionLongitudeRad: mvelpp,
		meanLongitudeAtEquinoxRad:
			2 *
			((0.5 * eccen + 0.125 * eccen3) * (1 + beta) * Math.sin(mvelpp) -
				0.25 * eccen2 * (0.5 + beta) * Math.sin(2 * mvelpp) +
				0.125 * eccen3 * (1 / 3 + beta) * Math.sin(3 * mvelpp)),
	}
}

export const CALENDAR = {
	CLIMATOLOGY_MONTHS,
	orbit,
	solar,
	monthInterpolation,
}
