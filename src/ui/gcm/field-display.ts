import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmMapMode } from "@/model/climate/gcm/fields/types"
import { COLOR_INTERPOLATION } from "@/model/shared/color/color-interpolation"
import { COLOR_PALETTES } from "@/model/shared/color/color-palettes"
import type { RgbColor } from "@/model/shared/color/color-palettes/types"
import type {
	GcmColorScale,
	GcmFormattedValue,
	GcmModeValue,
} from "@/ui/gcm/types"
import { precipitationMonthlyColor } from "@/ui/genesis/shared/colors/precipitation"
import { temperatureColor } from "@/ui/genesis/shared/colors/temperature"
import {
	formatPrecipitation,
	formatSpeed,
	formatTemperature,
	formatWithUnit,
} from "@/ui/genesis/shared/ui-format"

const DAYS_PER_MONTH = 30

function stops(palette: readonly RgbColor[]): GcmColorScale {
	return (t) =>
		COLOR_INTERPOLATION.sampleColorStops({
			stops: palette,
			t: Math.max(0, Math.min(1, t)),
		})
}

const NORMALIZED_SCALES: Partial<Record<GcmMapMode, GcmColorScale>> = {
	wind: stops(COLOR_PALETTES.plasmaStops),
	jet: stops(COLOR_PALETTES.plasmaStops),
	cloudCover: stops(COLOR_PALETTES.cloudStops),
	surfacePressure: stops(COLOR_PALETTES.spectralStops.toReversed()),
	waterVapor: stops(COLOR_PALETTES.bupuStops),
	seaIce: stops(COLOR_PALETTES.cloudStops),
	snowDepth: stops(COLOR_PALETTES.cloudStops),
	soilWater: stops(COLOR_PALETTES.bupuStops),
	albedo: stops(COLOR_PALETTES.orangesStops),
	outgoingLongwave: stops(COLOR_PALETTES.ylOrRdStops),
}

function color({ mode, value }: GcmModeValue): RgbColor {
	if (mode === "surfaceTemperature" || mode === "airTemperature") {
		return temperatureColor(value)
	}
	if (mode === "precipitation") {
		return precipitationMonthlyColor(value * DAYS_PER_MONTH)
	}
	const { min, max } = GCM_FIELDS.definition(mode)
	return (NORMALIZED_SCALES[mode] as GcmColorScale)((value - min) / (max - min))
}

function format({ mode, value, unitSystem }: GcmFormattedValue): string {
	switch (GCM_FIELDS.definition(mode).unit) {
		case "celsius":
			return formatTemperature(value, unitSystem)
		case "metersPerSecond":
			return formatSpeed(value, unitSystem)
		case "millimetersPerDay":
			return `${formatPrecipitation(value, unitSystem, 1)}/day`
		case "millimeters":
			return formatPrecipitation(value, unitSystem)
		case "centimeters":
			return formatPrecipitation(value * 10, unitSystem)
		case "kilogramsPerSquareMeter":
			return formatWithUnit(value, "kg/m²", 1)
		case "hectopascals":
			return formatWithUnit(value, "hPa", 0)
		case "percent":
			return formatWithUnit(value, "%", 0)
		case "wattsPerSquareMeter":
			return formatWithUnit(value, "W/m²", 0)
	}
}

export const GCM_DISPLAY = {
	color,
	format,
}
