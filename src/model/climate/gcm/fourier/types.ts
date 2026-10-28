export interface GcmFourierSize {
	longitudes: number
	truncation: number
}

export interface GcmFourierTables {
	forward: Float64Array
	inverse: Float64Array
}

// One grid field (latitude rows of longitudes) for gp2fc on the CPU.
export interface GcmFourierAnalysis {
	values: ArrayLike<number>
	longitudes: number
	truncation: number
}
