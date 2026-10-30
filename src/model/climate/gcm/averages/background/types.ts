import type {
	GcmAverager,
	GcmAverageState,
	GcmMonthlyMean,
} from "@/model/climate/gcm/averages/types"
import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type { GcmConfig, GcmSnapshot } from "@/model/climate/gcm/types"

export interface GcmBackgroundSample {
	months: GcmMonthlyMean[]
	years: GcmYearlyBalance[]
	config: GcmConfig
}

export interface GcmBackgroundRequest {
	averager: GcmAverager
	config: GcmConfig
	onUpdate(averages: GcmAverageState): void
	onError(message: string): void
}

export interface GcmBackgroundAnalysis {
	update(sample: GcmBackgroundSample): void
	stop(): void
}

export type GcmBackgroundMessage =
	| { type: "initialize"; averager: GcmAverager; config: GcmConfig }
	| { type: "update"; sample: GcmBackgroundSample }

export interface GcmBackgroundClimate {
	months: GcmMonthlyMean[]
	years: number
	koppen: Uint8Array | null
	pasta: Uint8Array | null
}

export type GcmBackgroundResponse =
	| { type: "failed"; message: string }
	| {
			type: "updated"
			months: GcmMonthlyMean[]
			years: GcmYearlyBalance[]
			annual: GcmSnapshot | null
			climate: GcmBackgroundClimate | null
	  }
