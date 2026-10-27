import type {
	GfortranRandomState,
	GfortranRotation,
} from "@/model/shared/random/gfortran/types"

// libgfortran's random_seed(put=) and random_number for real(8)
// (intrinsics/random.c, GCC 7 and later), so a seeded Fortran run's random
// numbers can be reproduced bit for bit.
const MASK = (1n << 64n) - 1n
const XOR_KEYS = [
	0xbd0c5b6e50c2df49n,
	0xd46061cd46e1df38n,
	0xbb4f4d4ed6103544n,
	0x114a583d0756ad39n,
]
const SEED_SIZE = 8

function rotl({ value, bits }: GfortranRotation): bigint {
	return ((value << bits) | (value >> (64n - bits))) & MASK
}

// random_seed(put=seed): the eight 32-bit words in reverse order, read as
// four little-endian 64-bit words and XORed with the scrambling keys.
function seeded(seed: ReadonlyArray<number>): GfortranRandomState {
	if (seed.length !== SEED_SIZE)
		throw new Error(
			`gfortran seeds have ${SEED_SIZE} words, not ${seed.length}`,
		)
	const reversed = Array.from(seed, (_, i) =>
		BigInt.asUintN(32, BigInt(seed[SEED_SIZE - 1 - i])),
	)
	const words = new BigUint64Array(XOR_KEYS.length)
	for (let i = 0; i < words.length; i++)
		words[i] = (reversed[2 * i] | (reversed[2 * i + 1] << 32n)) ^ XOR_KEYS[i]
	return { words }
}

// random_number for real(8): xoshiro256**'s next word, its top 53 bits
// scaled by 2^-64.
function next(state: GfortranRandomState): number {
	const s = state.words
	const result = (rotl({ value: (s[1] * 5n) & MASK, bits: 7n }) * 9n) & MASK
	const t = (s[1] << 17n) & MASK
	s[2] ^= s[0]
	s[3] ^= s[1]
	s[1] ^= s[2]
	s[0] ^= s[3]
	s[2] ^= t
	s[3] = rotl({ value: s[3], bits: 45n })
	return Number(result >> 11n) * 2 ** -53
}

export const GFORTRAN_RANDOM = {
	SEED_SIZE,
	seeded,
	next,
}
