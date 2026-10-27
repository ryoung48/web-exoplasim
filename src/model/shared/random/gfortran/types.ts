// libgfortran's xoshiro256** state: four 64-bit words.
export interface GfortranRandomState {
	words: BigUint64Array
}

export interface GfortranRotation {
	value: bigint
	bits: bigint
}
