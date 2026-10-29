import type {
	KoppenOceanClimate,
	KoppenOceanCode,
} from "@/model/climate/classification/koppen/ocean/types"
import type { RgbColor } from "@/model/shared/color/color-palettes/types"

const CLASSES = [
	{
		code: "SeaTrop",
		name: "Tropical sea",
		color: [9 / 255, 120 / 255, 171 / 255] as RgbColor,
	},
	{
		code: "SeaTemp",
		name: "Temperate sea",
		color: [113 / 255, 171 / 255, 216 / 255] as RgbColor,
	},
	{
		code: "SeaSeasonalIce",
		name: "Seasonal sea ice",
		color: [185 / 255, 227 / 255, 1] as RgbColor,
	},
	{
		code: "SeaPermIce",
		name: "Permanent sea ice",
		color: [226 / 255, 248 / 255, 1] as RgbColor,
	},
] as const

function classify({
	minimumTemperatureC,
	minimumIceFraction,
	maximumIceFraction,
}: KoppenOceanClimate): KoppenOceanCode {
	if (maximumIceFraction > 0.2)
		return minimumIceFraction > 0.8 ? "SeaPermIce" : "SeaSeasonalIce"
	return minimumTemperatureC > 18 ? "SeaTrop" : "SeaTemp"
}

export const KOPPEN_OCEAN = { CLASSES, classify }
