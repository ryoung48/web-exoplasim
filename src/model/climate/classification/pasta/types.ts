import type { PastaHydrology } from "@/model/climate/classification/pasta/hydrology/types"
import type { RgbColor } from "@/model/shared/color/color-palettes/types"

export interface PastaClass {
	code: string
	name: string
	color: RgbColor
}

export interface PastaCell {
	monthDays: number
	pressureHpa: number[]
	hydrology: PastaHydrology | null
	land: boolean
	downscaled: boolean
	temperature: number[]
	minimum: number[]
	maximum: number[]
	rainfall: number[]
	light: number[]
	surfaceTemperature: number[]
	seaIce: number[]
	snow: number[]
}

export interface PastaSeason {
	values: number[]
	interruptions: number[]
	threshold: number
}

export interface PastaZone {
	boiling: boolean
	min: number
	max: number
	growth: number
	zeroGrowth: number
	interruption: number
	aridity: number
	growthAridity: number
	supply: number
	evaporationRatio: number
	ice: boolean
}

export interface PastaRatio {
	numerator: number
	denominator: number
}

export type PastaClassLabel = Omit<PastaClass, "color">
