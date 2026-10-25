interface CreateRngOptions {
	nonPositiveWeightBehavior?: "first" | "undefined"
}

export interface CreateRngParams {
	seed: number
	options?: CreateRngOptions
}

export interface CreateStringRngParams {
	seed: string
	options?: CreateRngOptions
}
export interface CreateSourceRngParams {
	random: () => number
	nonPositiveWeightBehavior: "undefined" | "first"
}
