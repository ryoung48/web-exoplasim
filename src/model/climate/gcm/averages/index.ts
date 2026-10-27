import type {
	GcmAverager,
	GcmAveragerSample,
	GcmMonthAccumulator,
	GcmMonthlyMean,
} from "@/model/climate/gcm/averages/types"
import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmFieldId } from "@/model/climate/gcm/fields/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import type { GcmSnapshot } from "@/model/climate/gcm/types"

const MONTHS_PER_YEAR = 12
// PlaSim divides its calendar into twelve equally weighted sampling months.

function create(): GcmAverager {
	return { current: null, months: [], years: [] }
}

function yearly(averager: GcmAverager): GcmYearlyBalance | null {
	const { months } = averager
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
	const snapshot = { ...accumulator.last, values }
	GCM_FIELDS.field({ snapshot, field: "airTemperatureMin" }).set(
		accumulator.minimum,
	)
	GCM_FIELDS.field({ snapshot, field: "airTemperatureMax" }).set(
		accumulator.maximum,
	)
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
		minimum: new Float32Array(
			GCM_FIELDS.field({ snapshot, field: "airTemperatureMin" }),
		),
		maximum: new Float32Array(
			GCM_FIELDS.field({ snapshot, field: "airTemperatureMax" }),
		),
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
		const minimum = GCM_FIELDS.field({ snapshot, field: "airTemperatureMin" })
		const maximum = GCM_FIELDS.field({ snapshot, field: "airTemperatureMax" })
		for (let point = 0; point < minimum.length; point++) {
			current.minimum[point] = Math.min(current.minimum[point], minimum[point])
			current.maximum[point] = Math.max(current.maximum[point], maximum[point])
		}
		for (let index = 0; index < current.sum.length; index++) {
			current.sum[index] += snapshot.values[index]
		}
		current.samples++
		current.last = snapshot
		return false
	}
	averager.current = open(snapshot)
	if (!current) return false
	averager.months = [...averager.months, close(current)].slice(-MONTHS_PER_YEAR)
	const year = yearly(averager)
	if (year) averager.years = [...averager.years, year]
	return true
}

function annual(averager: GcmAverager): GcmSnapshot | null {
	if (averager.months.length < MONTHS_PER_YEAR) return null
	const [first] = averager.months
	const last = averager.months[averager.months.length - 1]
	const values = new Float32Array(first.snapshot.values.length)
	for (const month of averager.months) {
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
	for (const month of averager.months) {
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
	create,
	add,
	annual,
}
