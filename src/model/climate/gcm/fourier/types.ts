export interface GcmFourierSize {
	longitudes: number
	truncation: number
}

export interface GcmFourierTables {
	forward: Float64Array
	inverse: Float64Array
}
