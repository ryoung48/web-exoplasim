export function temperatureColor(celsius: number): [number, number, number] {
	const clamped = Math.max(
		tempStops[0].c,
		Math.min(tempStops[tempStops.length - 1].c, celsius),
	)
	for (let i = 0; i < tempStops.length - 1; i++) {
		const a = tempStops[i]
		const b = tempStops[i + 1]
		if (clamped <= b.c) {
			const t = (clamped - a.c) / (b.c - a.c)
			return [
				a.r + t * (b.r - a.r),
				a.g + t * (b.g - a.g),
				a.b + t * (b.b - a.b),
			]
		}
	}
	const last = tempStops[tempStops.length - 1]
	return [last.r, last.g, last.b]
}

const tempStops: { c: number; r: number; g: number; b: number }[] = [
	{ c: -73, r: 0.973, g: 0.984, b: 1.0 },
	{ c: -51.11, r: 0.863, g: 0.933, b: 0.98 },
	{ c: -40, r: 0.639, g: 0.761, b: 0.902 },
	{ c: -28.89, r: 0.549, g: 0.714, b: 0.847 },
	{ c: -17.78, r: 0.392, g: 0.584, b: 0.804 },
	{ c: 0, r: 0.18, g: 0.349, b: 0.518 },
	{ c: 4.44, r: 0.231, g: 0.62, b: 0.749 },
	{ c: 10, r: 0.416, g: 0.804, b: 0.847 },
	{ c: 15.56, r: 0.608, g: 0.835, b: 0.624 },
	{ c: 21.11, r: 0.824, g: 0.902, b: 0.498 },
	{ c: 23.89, r: 0.945, g: 0.894, b: 0.494 },
	{ c: 26.67, r: 0.941, g: 0.776, b: 0.435 },
	{ c: 29.44, r: 0.949, g: 0.631, b: 0.369 },
	{ c: 32.22, r: 0.957, g: 0.608, b: 0.259 },
	{ c: 35, r: 0.937, g: 0.49, b: 0.231 },
	{ c: 37.78, r: 0.882, g: 0.361, b: 0.31 },
	{ c: 40.56, r: 0.839, g: 0.286, b: 0.392 },
	{ c: 43.33, r: 0.729, g: 0.184, b: 0.427 },
	{ c: 46.11, r: 0.639, g: 0.082, b: 0.388 },
	{ c: 48.89, r: 0.49, g: 0.0, b: 0.31 },
	{ c: 80, r: 0.353, g: 0.0, b: 0.184 },
]
