import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type { GcmConfig, GcmSnapshot } from "@/model/climate/gcm/types"

export interface GcmMonthlyMean {
	year: number
	month: number
	snapshot: GcmSnapshot
}

export interface GcmMonthAccumulator {
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

export interface GcmAverageState {
	months: GcmMonthlyMean[]
	climateMonths: GcmMonthlyMean[]
	climateYears: number
	years: GcmYearlyBalance[]
	annual: GcmSnapshot | null
	koppen: Uint8Array | null
	pasta: Uint8Array | null
}

export interface GcmClimatology {
	months: GcmMonthlyMean[]
	years: number
}

export interface GcmClimateCache {
	climate: GcmClimatology
	config: GcmConfig
	koppen: Uint8Array | null
	pasta: Uint8Array | null
}

export interface GcmAverageMerge {
	averager: GcmAverager
	months: GcmMonthlyMean[]
	years: GcmYearlyBalance[]
}

export interface GcmMonthMerge {
	months: GcmMonthlyMean[]
	incoming: GcmMonthlyMean[]
	limit: number
}

export interface GcmAveragesRequest {
	averager: GcmAverager
	config: GcmConfig
}
