import type {
	PastaPotentialMonth,
	PastaWater,
} from "@/model/climate/classification/pasta/hydrology/types"

function evaporation({ rainfall, potential }: PastaWater): number[] {
	let soil = 0
	const actual = new Array<number>(12).fill(0)
	for (let year = 0; year < 100; year++) {
		const initial = soil
		for (let month = 0; month < 12; month++) {
			const deficit = potential[month] - rainfall[month]
			const drawn = Math.min(
				soil,
				Math.max(0, deficit) * Math.min(1, soil / 250),
			)
			actual[month] = deficit <= 0 ? potential[month] : rainfall[month] + drawn
			soil = Math.min(
				500,
				Math.max(0, soil - deficit + (deficit > 0 ? deficit - drawn : 0)),
			)
		}
		if (Math.abs(soil - initial) <= 10) break
	}
	return actual
}

// Scalar ASCE-style equations from koppenpasta Calc_PET, using its
// mean-temperature saturation and zero soil-heat-flux fallback.
function potentialMonth(input: PastaPotentialMonth): number {
	const {
		temperature,
		pressureKpa,
		humidityPercent,
		windMs,
		forestFraction,
		gasConstant,
		monthDays,
		netRadiationWm2,
	} = input
	const latentHeat = 2.501 - 0.002361 * temperature
	const molecularRatio = (0.622 * 287.05) / gasConstant
	const psychrometric = (0.001013 * pressureKpa) / (molecularRatio * latentHeat)
	const saturation =
		0.6108 * Math.exp((17.27 * temperature) / (temperature + 237.3))
	const slope = (4098 * saturation) / (temperature + 237.3) ** 2
	const vaporDeficit = saturation * (1 - humidityPercent / 100)
	const aerodynamic =
		(windMs * (900 + 500 * forestFraction)) / (temperature + 273.15)
	const denominator =
		slope + psychrometric * (1 + (0.34 + 0.04 * forestFraction) * windMs)
	const daily =
		((slope * netRadiationWm2 * 0.0864) / latentHeat +
			psychrometric * aerodynamic * vaporDeficit) /
		denominator
	return Math.max(0, daily) * monthDays
}

export const PASTA_HYDROLOGY = { potentialMonth, evaporation }
