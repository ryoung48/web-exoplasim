import type {
	GcmBalanceAssessment,
	GcmYearlyBalance,
} from "@/model/climate/gcm/balance/types"

// ExoPlaSim's Model._isbalanced (exoplasim/__init__.py at 5f8dff4): absolute
// 10-year running means of the yearly global balances, least-squares slopes
// over 5 consecutive running means, and the mean of the last 30 slopes must
// be under 5e-4 W/m^2 per year at both the top of atmosphere and the surface.
const RUNNING_MEAN_YEARS = 10
const SLOPE_WINDOW = 5
const SLOPES_AVERAGED = 30
const THRESHOLD_W_M2_PER_YEAR = 5e-4
const MINIMUM_YEARS = RUNNING_MEAN_YEARS + SLOPE_WINDOW - 1

function mean(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0) / values.length
}

function slope(values: ReadonlyArray<number>): number {
	const xMean = (values.length + 1) / 2
	const yMean = mean(values)
	let numerator = 0
	let denominator = 0
	values.forEach((value, index) => {
		const x = index + 1 - xMean
		numerator += x * (value - yMean)
		denominator += x * x
	})
	return numerator / denominator
}

function drift(series: ReadonlyArray<number>): number {
	const runningMeans = []
	for (let end = RUNNING_MEAN_YEARS; end <= series.length; end++) {
		runningMeans.push(
			Math.abs(mean(series.slice(end - RUNNING_MEAN_YEARS, end))),
		)
	}
	const slopes = []
	for (let end = SLOPE_WINDOW; end <= runningMeans.length; end++) {
		slopes.push(slope(runningMeans.slice(end - SLOPE_WINDOW, end)))
	}
	return Math.abs(mean(slopes.slice(-SLOPES_AVERAGED)))
}

function assess(years: ReadonlyArray<GcmYearlyBalance>): GcmBalanceAssessment {
	if (years.length < MINIMUM_YEARS) {
		return {
			status: "spinning-up",
			yearsNeeded: MINIMUM_YEARS - years.length,
			toaDriftPerYear: Number.NaN,
			surfaceDriftPerYear: Number.NaN,
		}
	}
	const toaDriftPerYear = drift(years.map((year) => year.toaNetRadiation))
	const surfaceDriftPerYear = drift(years.map((year) => year.surfaceNetHeat))
	return {
		status:
			toaDriftPerYear < THRESHOLD_W_M2_PER_YEAR &&
			surfaceDriftPerYear < THRESHOLD_W_M2_PER_YEAR
				? "balanced"
				: "drifting",
		yearsNeeded: 0,
		toaDriftPerYear,
		surfaceDriftPerYear,
	}
}

export const GCM_BALANCE = {
	THRESHOLD_W_M2_PER_YEAR,
	assess,
}
