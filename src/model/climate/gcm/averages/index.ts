import { KOPPEN } from "@/model/climate/classification/koppen"
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
// PlaSim's calendar has twelve 30-day months, so monthly means weigh equally.
const DAYS_PER_MONTH = 30
const LAND_FRACTION_THRESHOLD = 0.5

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
	return {
		layers: last.snapshot.layers,
		step: last.snapshot.step,
		date: last.snapshot.date,
		values,
	}
}

// Classifies the last 12 completed months with the repository's Köppen
// rules, from 2 m air temperature and precipitation totals.
function koppen(averager: GcmAverager): Uint8Array | null {
	if (averager.months.length < MONTHS_PER_YEAR) return null
	const ordered = averager.months.toSorted((a, b) => a.month - b.month)
	const reference = ordered[0].snapshot
	const points = GCM_FIELDS.grid(reference).points
	const landFraction = GCM_FIELDS.field({
		snapshot: reference,
		field: "landFraction",
	})
	const isLand = Uint8Array.from(landFraction, (fraction) =>
		fraction >= LAND_FRACTION_THRESHOLD ? 1 : 0,
	)
	const temperatureMonthly = new Float32Array(MONTHS_PER_YEAR * points)
	const rainfallMonthly = new Float32Array(MONTHS_PER_YEAR * points)
	ordered.forEach(({ snapshot }, month) => {
		temperatureMonthly.set(
			GCM_FIELDS.values({ snapshot, mode: "airTemperature" }),
			month * points,
		)
		const rain = GCM_FIELDS.values({ snapshot, mode: "precipitation" })
		rainfallMonthly.set(
			rain.map((millimetersPerDay) => millimetersPerDay * DAYS_PER_MONTH),
			month * points,
		)
	})
	const classes = new Uint8Array(points)
	KOPPEN.koppenCells({
		start: 0,
		end: points,
		isLand,
		temperatureMonthly,
		rainfallMonthly,
		classes,
	})
	return classes
}

export const GCM_AVERAGES = {
	MONTHS_PER_YEAR,
	create,
	add,
	annual,
	koppen,
}
