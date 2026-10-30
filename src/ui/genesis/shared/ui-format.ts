import { TEMPERATURE } from "@/model/shared/units/temperature"

export type UnitSystem = "metric" | "imperial"

const KM_TO_MI = 0.621371
export const KM_TO_FT = 3280.839895
const MM_TO_IN = 0.0393701
const M3S_TO_FT3S = 35.314667
const KM2_TO_MI2 = 0.386102
const MS_TO_MPH = 2.236936
const WIND_DIR_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

export function rgbToCss([r, g, b]: [number, number, number]): string {
	return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

export function formatWithUnit(
	value: number,
	unit: string,
	digits: number,
	options?: { compact?: boolean },
): string {
	const separator = options?.compact ? "" : " "
	return `${value.toFixed(digits)}${separator}${unit}`
}

export function formatTemperature(
	valueC: number,
	unitSystem: UnitSystem,
	digits = 1,
	options?: { compact?: boolean },
): string {
	const value = TEMPERATURE.toDisplay({ value: valueC, system: unitSystem })
	return formatWithUnit(
		value,
		unitSystem === "imperial" ? "°F" : "°C",
		digits,
		options,
	)
}

export function formatTemperatureDelta(
	valueC: number,
	unitSystem: UnitSystem,
	digits = 1,
	options?: { compact?: boolean },
): string {
	const value = unitSystem === "imperial" ? valueC * (9 / 5) : valueC
	return formatWithUnit(
		value,
		unitSystem === "imperial" ? "°F" : "°C",
		digits,
		options,
	)
}

export function compactFeet(feet: number): string {
	const abs = Math.abs(feet)
	const sign = feet < 0 ? "-" : ""
	if (abs >= 1_000_000)
		return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`
	if (abs >= 1_000)
		return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`
	return `${sign}${Math.round(abs).toLocaleString()}`
}

export function formatElevation(
	valueKm: number,
	unitSystem: UnitSystem,
	digits = 2,
): string {
	if (unitSystem === "imperial") {
		const feet = Math.round(valueKm * KM_TO_FT)
		return `${compactFeet(feet)} ft`
	}
	return `${valueKm.toFixed(digits)} km`
}

export function formatDistance(
	valueKm: number,
	unitSystem: UnitSystem,
	options?: { under100Digits?: number; over100Digits?: number },
): string {
	const converted = unitSystem === "imperial" ? valueKm * KM_TO_MI : valueKm
	const unit = unitSystem === "imperial" ? "mi" : "km"
	const digits =
		converted < 100
			? (options?.under100Digits ?? 0)
			: (options?.over100Digits ?? 0)
	const formatted =
		digits > 0
			? converted.toFixed(digits)
			: Math.round(converted).toLocaleString()
	return `${formatted} ${unit}`
}

export function formatPrecipitation(
	valueMm: number,
	unitSystem: UnitSystem,
	digits = 0,
	options?: { compact?: boolean },
): string {
	const value = unitSystem === "imperial" ? valueMm * MM_TO_IN : valueMm
	const nextDigits = unitSystem === "imperial" ? Math.max(digits, 1) : digits
	return formatWithUnit(
		value,
		unitSystem === "imperial" ? "in" : "mm",
		nextDigits,
		options,
	)
}

export function formatDensity(
	valuePerKm2: number,
	unitSystem: UnitSystem,
	digits = 1,
): string {
	const value =
		unitSystem === "imperial" ? valuePerKm2 / KM2_TO_MI2 : valuePerKm2
	return `${value.toFixed(digits)}/${unitSystem === "imperial" ? "mi²" : "km²"}`
}

export function formatArea(
	valueKm2: number,
	unitSystem: UnitSystem,
	options?: { digits?: number; compact?: "k" | "M" },
): string {
	const value = unitSystem === "imperial" ? valueKm2 * KM2_TO_MI2 : valueKm2
	const unit = unitSystem === "imperial" ? "mi²" : "km²"
	const digits = options?.digits ?? 0
	if (options?.compact === "k")
		return `${(value / 1_000).toFixed(digits)}k ${unit}`
	if (options?.compact === "M")
		return `${(value / 1_000_000).toFixed(digits)}M ${unit}`
	return `${value.toFixed(digits)} ${unit}`
}

export function formatFlowRate(
	valueM3s: number,
	unitSystem: UnitSystem,
	formatValue: (value: number) => string,
): string {
	const value = unitSystem === "imperial" ? valueM3s * M3S_TO_FT3S : valueM3s
	return `${formatValue(value)} ${unitSystem === "imperial" ? "ft³/s" : "m³/s"}`
}

export function formatSpeed(
	valueMs: number,
	unitSystem: UnitSystem,
	digits = 1,
): string {
	const value = unitSystem === "imperial" ? valueMs * MS_TO_MPH : valueMs
	return formatWithUnit(
		value,
		unitSystem === "imperial" ? "mph" : "m/s",
		digits,
	)
}

// "coming from" convention: negate u/v to get the source direction
export function windDirectionLabel(u: number, v: number): string {
	const deg = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360
	return WIND_DIR_LABELS[Math.round(deg / 45) % 8] ?? "N"
}
