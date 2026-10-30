import type { TemperatureConversion } from "@/model/shared/units/temperature/types"

function toDisplay({ value, system }: TemperatureConversion): number {
	return system === "imperial" ? value * (9 / 5) + 32 : value
}

function toCelsius({ value, system }: TemperatureConversion): number {
	return system === "imperial" ? (value - 32) * (5 / 9) : value
}

export const TEMPERATURE = { toDisplay, toCelsius }
