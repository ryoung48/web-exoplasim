import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type { GcmSnapshot } from "@/model/climate/gcm/types"

export interface GcmMonthlyMean {
	year: number
	month: number
	snapshot: GcmSnapshot
}

export interface GcmMonthAccumulator {
	minimum: Float32Array
	maximum: Float32Array
	year: number
	month: number
	sum: Float64Array
	samples: number
	last: GcmSnapshot
}

export interface GcmAverager {
	current: GcmMonthAccumulator | null
	months: GcmMonthlyMean[]
	years: GcmYearlyBalance[]
}

export interface GcmAveragerSample {
	averager: GcmAverager
	snapshot: GcmSnapshot
}
