import type {
	CreateRngParams,
	CreateSourceRngParams,
	CreateStringRngParams,
} from "@/model/shared/random/rng/types"

export type WeightedValue<T> = { v: T; w: number }

export interface SharedRng {
	random(): number
	uniform(min?: number, max?: number): number
	randint(a: number, b: number): number
	choice<T>(arr: readonly T[]): T
	weightedChoice<T>(arr: readonly WeightedValue<T>[]): T | undefined
	shuffle<T>(arr: readonly T[]): T[]
	sample<T>(arr: readonly T[], count: number): T[]
	weightedSample<T>(
		arr: readonly WeightedValue<T>[],
		count: number,
		unique?: boolean,
	): T[]
}

function seedStringToNumber(seed: string): number {
	const normalized = seed.trim().toLowerCase()
	if (/^[0-9a-z]+$/.test(normalized)) {
		const parsed = Number.parseInt(normalized, 36)
		if (Number.isFinite(parsed) && parsed !== 0) return parsed
	}

	let hash = 2166136261
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return Math.abs(hash) || 1
}

function makeRng(seed: number): () => number {
	let s = (Math.abs(Math.floor(seed * 9301 + 49297)) % 2147483646) + 1
	return () => {
		s = (s * 16807) % 2147483647
		return (s - 1) / 2147483646
	}
}

function makeRandInt(seed: number): (n: number) => number {
	const r = makeRng(seed)
	return (n: number) => Math.floor(r() * n)
}

function createRng({ seed, options = {} }: CreateRngParams): SharedRng {
	return fromSource({
		random: makeRng(seed),
		nonPositiveWeightBehavior: options.nonPositiveWeightBehavior ?? "undefined",
	})
}

function fromSource({
	random,
	nonPositiveWeightBehavior,
}: CreateSourceRngParams): SharedRng {
	const next = () => random()

	const randint = (a: number, b: number) =>
		a + Math.floor(next() * (Math.floor(b) - Math.ceil(a) + 1))

	const uniform = (min = 0, max = 1) => next() * (max - min) + min

	const choice = <T>(arr: readonly T[]): T =>
		arr[randint(0, Math.max(0, arr.length - 1))] as T

	const weightedChoice = <T>(
		arr: readonly WeightedValue<T>[],
	): T | undefined => {
		let total = 0
		for (const entry of arr) total += entry.w
		if (total <= 0) {
			return nonPositiveWeightBehavior === "first"
				? (arr[0]?.v as T | undefined)
				: undefined
		}

		let roll = uniform(0, total)
		for (const entry of arr) {
			roll -= entry.w
			if (roll <= 0) return entry.v
		}
		return arr[arr.length - 1]?.v
	}

	const shuffle = <T>(arr: readonly T[]): T[] => {
		const result = [...arr]
		for (let i = result.length - 1; i > 0; i--) {
			const j = randint(0, i)
			const tmp = result[i]
			result[i] = result[j]
			result[j] = tmp
		}
		return result
	}

	const sample = <T>(arr: readonly T[], count: number): T[] =>
		shuffle(arr).slice(0, count)

	const weightedSample = <T>(
		arr: readonly WeightedValue<T>[],
		count: number,
		unique = true,
	): T[] => {
		let items = [...arr]
		const selected: T[] = []
		let remaining = count

		while (remaining-- > 0 && items.length > 0) {
			const chosen = weightedChoice(items)
			if (chosen === undefined) break
			selected.push(chosen)
			if (unique) items = items.filter((entry) => entry.v !== chosen)
		}

		return selected
	}

	return {
		random: next,
		uniform,
		randint,
		choice,
		weightedChoice,
		shuffle,
		sample,
		weightedSample,
	}
}

function createStringRng({ seed, options }: CreateStringRngParams): SharedRng {
	return createRng({ seed: seedStringToNumber(seed), options })
}

export const RNG = {
	fromSource,
	seedStringToNumber,
	makeRng,
	makeRandInt,
	createRng,
	createStringRng,
}
