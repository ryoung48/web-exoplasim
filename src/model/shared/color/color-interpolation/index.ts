import type {
	BasisParams,
	LerpParams,
	MapLinearParams,
	MixRgbParams,
	RgbColor,
	SampleBasisColorStopsParams,
	SampleColorStopsParams,
} from "@/model/shared/color/color-interpolation/types"
import { MATH } from "@/model/shared/math/core"

function lerp({ a, b, t }: LerpParams): number {
	return MATH.lerp({ start: a, end: b, position: t })
}

function mixRgb({ a, b, t }: MixRgbParams): RgbColor {
	return [
		lerp({ a: a[0], b: b[0], t }),
		lerp({ a: a[1], b: b[1], t }),
		lerp({ a: a[2], b: b[2], t }),
	]
}

function rgbToCss([r, g, b]: RgbColor): string {
	return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

function quantizeRgb([r, g, b]: RgbColor): RgbColor {
	return [
		Math.round(r * 255) / 255,
		Math.round(g * 255) / 255,
		Math.round(b * 255) / 255,
	]
}

function cssColorToRgb(value: string): RgbColor {
	if (value.startsWith("#")) {
		const hex = value.slice(1)
		if (hex.length === 3) {
			return [
				parseInt(hex[0] + hex[0], 16) / 255,
				parseInt(hex[1] + hex[1], 16) / 255,
				parseInt(hex[2] + hex[2], 16) / 255,
			]
		}
		return [
			parseInt(hex.slice(0, 2), 16) / 255,
			parseInt(hex.slice(2, 4), 16) / 255,
			parseInt(hex.slice(4, 6), 16) / 255,
		]
	}

	const match = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
	if (!match) {
		throw new Error(`Unsupported color format: ${value}`)
	}
	return [
		Number(match[1]) / 255,
		Number(match[2]) / 255,
		Number(match[3]) / 255,
	]
}

function mapLinear({
	value,
	domainStart,
	domainEnd,
	rangeStart,
	rangeEnd,
	clamp = false,
}: MapLinearParams): number {
	if (domainStart === domainEnd) return rangeEnd
	const t = (value - domainStart) / (domainEnd - domainStart)
	const normalized = clamp ? MATH.clamp01(t) : t
	return lerp({ a: rangeStart, b: rangeEnd, t: normalized })
}

function sampleColorStops({ stops, t }: SampleColorStopsParams): RgbColor {
	if (stops.length === 0) return [0, 0, 0]
	if (stops.length === 1) return [...stops[0]]
	const clamped = MATH.clamp01(t)
	const scaled = clamped * (stops.length - 1)
	const index = Math.min(stops.length - 2, Math.floor(scaled))
	return mixRgb({ a: stops[index], b: stops[index + 1], t: scaled - index })
}

function basis({ t, v0, v1, v2, v3 }: BasisParams): number {
	const t2 = t * t
	const t3 = t2 * t
	return (
		((1 - 3 * t + 3 * t2 - t3) * v0 +
			(4 - 6 * t2 + 3 * t3) * v1 +
			(1 + 3 * t + 3 * t2 - 3 * t3) * v2 +
			t3 * v3) /
		6
	)
}

function sampleBasisColorStops({
	stops,
	t,
}: SampleBasisColorStopsParams): RgbColor {
	if (stops.length === 0) return [0, 0, 0]
	if (stops.length === 1) return [...stops[0]]

	const n = stops.length - 1
	const clamped = MATH.clamp01(t)
	const raw = clamped * n
	const index = clamped >= 1 ? n - 1 : Math.floor(raw)
	const localT = raw - index
	const v1 = stops[index]
	const v2 = stops[index + 1]
	const v0 =
		index > 0
			? stops[index - 1]
			: ([2 * v1[0] - v2[0], 2 * v1[1] - v2[1], 2 * v1[2] - v2[2]] as RgbColor)
	const v3 =
		index < n - 1
			? stops[index + 2]
			: ([2 * v2[0] - v1[0], 2 * v2[1] - v1[1], 2 * v2[2] - v1[2]] as RgbColor)

	return [
		basis({ t: localT, v0: v0[0], v1: v1[0], v2: v2[0], v3: v3[0] }),
		basis({ t: localT, v0: v0[1], v1: v1[1], v2: v2[1], v3: v3[1] }),
		basis({ t: localT, v0: v0[2], v1: v1[2], v2: v2[2], v3: v3[2] }),
	]
}

export const COLOR_INTERPOLATION = {
	rgbToCss,
	quantizeRgb,
	cssColorToRgb,
	mapLinear,
	sampleColorStops,
	sampleBasisColorStops,
}
