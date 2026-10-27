export interface GcmGaussianLatitudes {
	degrees: Float64Array
	sines: Float64Array
	weights: Float64Array
}

export interface GcmLegendrePoint {
	degree: number
	at: number
}

export interface GcmGrid {
	longitudes: number
	latitudes: number
	points: number
	longitudeStepDeg: number
	latitudesDeg: Float64Array
	latitudeSines: Float64Array
	latitudeWeights: Float64Array
}
