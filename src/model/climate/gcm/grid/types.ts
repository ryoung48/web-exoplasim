export interface GcmGaussianLatitudes {
	degrees: Float64Array
	weights: Float64Array
}

export interface GcmGrid {
	longitudes: number
	latitudes: number
	points: number
	longitudeStepDeg: number
	latitudesDeg: Float64Array
	latitudeWeights: Float64Array
}
