export interface PastaWater {
	rainfall: number[]
	potential: number[]
}

export interface PastaHydrology {
	potential: number[]
	actual: number[] | null
}

export interface PastaPotentialMonth {
	temperature: number
	netRadiationWm2: number
	humidityPercent: number
	pressureKpa: number
	windMs: number
	forestFraction: number
	gasConstant: number
	monthDays: number
}
