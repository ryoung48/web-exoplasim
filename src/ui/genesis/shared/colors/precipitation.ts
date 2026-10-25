export function interpolatePrecipitationStops(
	mm: number,
	stops: ReadonlyArray<{ mm: number; r: number; g: number; b: number }>,
): [number, number, number] {
	for (let i = 0; i < stops.length - 1; i++) {
		const a = stops[i]
		const b = stops[i + 1]
		if (mm <= b.mm) {
			const t = (mm - a.mm) / (b.mm - a.mm)
			return [
				a.r + t * (b.r - a.r),
				a.g + t * (b.g - a.g),
				a.b + t * (b.b - a.b),
			]
		}
	}
	const last = stops[stops.length - 1]
	return [last.r, last.g, last.b]
}

export function precipitationMonthlyColor(
	mm: number,
): [number, number, number] {
	return interpolatePrecipitationStops(mm, monthlyPrecipStops)
}

export function precipitationAnnualColor(mm: number): [number, number, number] {
	return interpolatePrecipitationStops(mm, annualPrecipStops)
}

export function precipitationColor(mm: number): [number, number, number] {
	return precipitationMonthlyColor(mm)
}

export function precipitationDifferenceColor(
	diffMm: number,
): [number, number, number] {
	const clamped = Math.max(
		precipDiffStops[0].v,
		Math.min(precipDiffStops[precipDiffStops.length - 1].v, diffMm),
	)
	for (let i = 0; i < precipDiffStops.length - 1; i++) {
		const a = precipDiffStops[i]
		const b = precipDiffStops[i + 1]
		if (clamped <= b.v) {
			const t = (clamped - a.v) / (b.v - a.v)
			return [
				a.r + t * (b.r - a.r),
				a.g + t * (b.g - a.g),
				a.b + t * (b.b - a.b),
			]
		}
	}
	const last = precipDiffStops[precipDiffStops.length - 1]
	return [last.r, last.g, last.b]
}

export function moistureDirectionalColor(
	normalized: number,
	isEastDominant: boolean,
): [number, number, number] {
	const tintStops = isEastDominant ? eastMoistureTints : westMoistureTints
	const clamped = Math.max(0, Math.min(1, normalized))
	const scaled = clamped * (tintStops.length - 1)
	const i = Math.min(tintStops.length - 2, Math.floor(scaled))
	const localT = scaled - i
	const a = tintStops[i]
	const b = tintStops[i + 1]
	return [
		a[0] + (b[0] - a[0]) * localT,
		a[1] + (b[1] - a[1]) * localT,
		a[2] + (b[2] - a[2]) * localT,
	]
}

const monthlyPrecipStops: { mm: number; r: number; g: number; b: number }[] = [
	{ mm: 0, r: 0.76, g: 0.7, b: 0.5 },
	{ mm: 10, r: 0.85, g: 0.78, b: 0.45 },
	{ mm: 40, r: 0.7, g: 0.82, b: 0.42 },
	{ mm: 83, r: 0.4, g: 0.75, b: 0.45 },
	{ mm: 125, r: 0.2, g: 0.65, b: 0.55 },
	{ mm: 165, r: 0.15, g: 0.5, b: 0.7 },
	{ mm: 250, r: 0.15, g: 0.3, b: 0.8 },
	{ mm: 400, r: 0.3, g: 0.15, b: 0.7 },
]

const annualPrecipStops = monthlyPrecipStops.map((stop) => ({
	...stop,
	mm: stop.mm * 12,
}))

const precipDiffStops: { v: number; r: number; g: number; b: number }[] = [
	{ v: -200, r: 0.35, g: 0.16, b: 0.06 },
	{ v: -100, r: 0.79, g: 0.46, b: 0.18 },
	{ v: -25, r: 0.96, g: 0.86, b: 0.62 },
	{ v: 0, r: 0.98, g: 0.97, b: 0.95 },
	{ v: 25, r: 0.76, g: 0.9, b: 0.78 },
	{ v: 100, r: 0.23, g: 0.63, b: 0.69 },
	{ v: 200, r: 0.08, g: 0.28, b: 0.48 },
]

const eastMoistureTints: [number, number, number][] = [
	[0.98, 0.95, 0.9],
	[0.97, 0.8, 0.52],
	[0.95, 0.58, 0.3],
	[0.75, 0.28, 0.18],
	[0.4, 0.12, 0.18],
]

const westMoistureTints: [number, number, number][] = [
	[0.97, 0.97, 0.92],
	[0.83, 0.95, 0.77],
	[0.54, 0.86, 0.6],
	[0.2, 0.65, 0.62],
	[0.12, 0.34, 0.62],
]
