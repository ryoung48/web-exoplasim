export interface GcmYearlyBalance {
	year: number
	toaNetRadiation: number
	surfaceNetHeat: number
	surfaceTemperature: number
}

export type GcmBalanceStatus = "spinning-up" | "drifting" | "balanced"

export interface GcmBalanceAssessment {
	status: GcmBalanceStatus
	yearsNeeded: number
	toaDriftPerYear: number
	surfaceDriftPerYear: number
}
