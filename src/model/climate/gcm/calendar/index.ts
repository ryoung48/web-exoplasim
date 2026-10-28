import { BERGER } from "@/model/climate/gcm/calendar/berger"
import { GCM_DATE } from "@/model/climate/gcm/calendar/date"
import { SOLAR } from "@/model/climate/gcm/calendar/solar"
import type {
	GcmBergerSeries,
	GcmOrbitParameters,
	GcmOrbitRequest,
} from "@/model/climate/gcm/calendar/types"

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
	CLIMATOLOGY_MONTHS: GCM_DATE.CLIMATOLOGY_MONTHS,
	orbit,
	solar: SOLAR.position,
	date: GCM_DATE.date,
	monthInterpolation: GCM_DATE.monthInterpolation,
	startStep: GCM_DATE.startStep,
}
