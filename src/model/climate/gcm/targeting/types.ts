import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

export interface GcmTargetTrial {
	year: number
	temperatureK: number
	fromCo2Ppm: number
	toCo2Ppm: number
}

export interface GcmTargetState {
	status: "settling" | "adjusting" | "converged" | "limited"
	initialCo2Ppm: number
	co2Ppm: number
	trialStartYear: number | null
	yearsAtForcing: number
	meanTemperatureK: number | null
	message: string
	history: GcmTargetTrial[]
}

export interface GcmTargetAssessment {
	state: GcmTargetState
	targetK: number
	years: ReadonlyArray<GcmYearlyBalance>
}

export interface GcmTargetForcing {
	config: GcmConfig
	co2Ppm: number
}

export interface GcmTargetUpdate {
	config: GcmConfig
	state: GcmTargetState
}
