export type RgbColor = [number, number, number]

export interface BasisParams {
	t: number
	v0: number
	v1: number
	v2: number
	v3: number
}

export interface LerpParams {
	a: number
	b: number
	t: number
}

export interface MapLinearParams {
	value: number
	domainStart: number
	domainEnd: number
	rangeStart: number
	rangeEnd: number
	clamp?: boolean
}

export interface MixRgbParams {
	a: RgbColor
	b: RgbColor
	t: number
}

export interface SampleColorStopsParams {
	stops: readonly RgbColor[]
	t: number
}

export interface SampleBasisColorStopsParams {
	stops: readonly RgbColor[]
	t: number
}
