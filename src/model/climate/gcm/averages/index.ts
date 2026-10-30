import type {
	GcmAverageMerge,
	GcmAverager,
	GcmAveragerSample,
	GcmAverageState,
	GcmAveragesRequest,
	GcmClimatology,
	GcmMonthAccumulator,
	GcmMonthlyMean,
} from "@/model/climate/gcm/averages/types"
import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import { GCM_CLASSIFICATION } from "@/model/climate/gcm/classification"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmFieldId } from "@/model/climate/gcm/fields/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import type { GcmSnapshot } from "@/model/climate/gcm/types"

const MONTHS_PER_YEAR = 12
const CLIMATE_YEARS = 10
const HISTORY_MONTHS = (CLIMATE_YEARS + 1) * MONTHS_PER_YEAR
// PlaSim divides its calendar into twelve equally weighted sampling months.

function create(): GcmAverager {
	return { current: null, months: [], years: [] }
}

function yearly(averager: GcmAverager): GcmYearlyBalance | null {
	const months = averager.months.slice(-MONTHS_PER_YEAR)
	const last = months[months.length - 1]
	if (
		months.length < MONTHS_PER_YEAR ||
		last.month !== MONTHS_PER_YEAR ||
		months.some((month) => month.year !== last.year)
	) {
		return null
	}
	const snapshot = annual(averager) as GcmSnapshot
	const mean = (field: GcmFieldId) =>
		GCM_GRID.globalMean(GCM_FIELDS.field({ snapshot, field }))
	return {
		year: last.year,
		toaNetRadiation: mean("toaNetRadiation"),
		surfaceNetHeat: mean("surfaceNetHeat"),
		surfaceTemperature: mean("surfaceTemperature"),
	}
}

function close(accumulator: GcmMonthAccumulator): GcmMonthlyMean {
	const values = new Float32Array(accumulator.sum.length)
	for (let index = 0; index < values.length; index++) {
		values[index] = accumulator.sum[index] / accumulator.samples
	}
	return {
		year: accumulator.year,
		month: accumulator.month,
		snapshot: {
			layers: accumulator.last.layers,
			step: accumulator.last.step,
			date: {
				year: accumulator.year,
				month: accumulator.month,
				day: 1,
				hour: 0,
				minute: 0,
			},
			values,
		},
	}
}

function open(snapshot: GcmSnapshot): GcmMonthAccumulator {
	return {
		year: snapshot.date.year,
		month: snapshot.date.month,
		sum: new Float64Array(snapshot.values),
		samples: 1,
		last: snapshot,
	}
}

// Returns true when a month closed, so callers redraw averages only then.
function add({ averager, snapshot }: GcmAveragerSample): boolean {
	const current = averager.current
	if (
		current &&
		current.month === snapshot.date.month &&
		current.year === snapshot.date.year
	) {
		for (let index = 0; index < current.sum.length; index++) {
			current.sum[index] += snapshot.values[index]
		}
		current.samples++
		current.last = snapshot
		return false
	}
	averager.current = open(snapshot)
	if (!current) return false
	averager.months = [...averager.months, close(current)].slice(-HISTORY_MONTHS)
	const year = yearly(averager)
	if (year) averager.years = [...averager.years, year]
	return true
}

function annual(averager: GcmAverager): GcmSnapshot | null {
	if (averager.months.length < MONTHS_PER_YEAR) return null
	const months = averager.months.slice(-MONTHS_PER_YEAR)
	const [first] = months
	const last = months[months.length - 1]
	const values = new Float32Array(first.snapshot.values.length)
	for (const month of months) {
		for (let index = 0; index < values.length; index++) {
			values[index] += month.snapshot.values[index] / MONTHS_PER_YEAR
		}
	}
	const snapshot: GcmSnapshot = {
		layers: last.snapshot.layers,
		step: last.snapshot.step,
		date: last.snapshot.date,
		values,
	}
	const range = GCM_FIELDS.field({
		snapshot,
		field: "dailyTemperatureRangeSum",
	})
	range.fill(0)
	for (const month of months) {
		const daily = GCM_FIELDS.values({
			snapshot: month.snapshot,
			mode: "diurnalTemperatureRange",
		})
		for (let point = 0; point < range.length; point++)
			range[point] += daily[point] / MONTHS_PER_YEAR
	}
	GCM_FIELDS.field({ snapshot, field: "dailyTemperatureRangeDays" }).fill(1)
	GCM_FIELDS.field({ snapshot, field: "diurnalTemperatureRange" }).set(range)
	return snapshot
}

export const GCM_AVERAGES = {
	MONTHS_PER_YEAR,
	CLIMATE_YEARS,
	create,
	add,
	annual,
	view: averages,
	merge,
}

function merge({ averager, months, years }: GcmAverageMerge): void {
	const history = new Map(
		averager.months.map((month) => [`${month.year}/${month.month}`, month]),
	)
	for (const month of months) history.set(`${month.year}/${month.month}`, month)
	averager.months = [...history.values()]
		.sort((a, b) => a.year - b.year || a.month - b.month)
		.slice(-HISTORY_MONTHS)
	averager.years = years
}

function climatology(averager: GcmAverager): GcmClimatology {
	const grouped = new Map<number, GcmMonthlyMean[]>()
	for (const month of averager.months) {
		const year = grouped.get(month.year) ?? []
		year.push(month)
		grouped.set(month.year, year)
	}
	const complete = [...grouped.values()]
		.filter(
			(year) =>
				year.length === MONTHS_PER_YEAR &&
				new Set(year.map((month) => month.month)).size === MONTHS_PER_YEAR,
		)
		.sort((a, b) => a[0].year - b[0].year)
		.slice(-CLIMATE_YEARS)
	if (!complete.length) return { months: [], years: 0 }
	const months = [...Array(MONTHS_PER_YEAR).keys()].map((index) => {
		const samples = complete.map(
			(year) =>
				year.find((month) => month.month === index + 1) as GcmMonthlyMean,
		)
		const last = samples[samples.length - 1]
		const sum = new Float64Array(last.snapshot.values.length)
		for (const sample of samples)
			for (let field = 0; field < sum.length; field++)
				sum[field] += sample.snapshot.values[field]
		const snapshot = {
			...last.snapshot,
			values: Float32Array.from(sum, (value) => value / samples.length),
		}
		return { ...last, snapshot }
	})
	return { months, years: complete.length }
}

function averages({ averager, config }: GcmAveragesRequest): GcmAverageState {
	const climate = climatology(averager)
	return {
		months: averager.months.slice(-MONTHS_PER_YEAR),
		climateMonths: climate.months,
		climateYears: climate.years,
		years: averager.years,
		annual: annual(averager),
		pasta: GCM_CLASSIFICATION.classes({
			config,
			months: climate.months,
			downscale: null,
			scheme: "pasta",
		}),
		koppen: GCM_CLASSIFICATION.classes({
			config,
			months: climate.months,
			downscale: null,
			scheme: "koppen",
		}),
	}
}
