export interface KoppenOceanClimate {
	minimumTemperatureC: number
	minimumIceFraction: number
	maximumIceFraction: number
}

export type KoppenOceanCode =
	| "SeaTrop"
	| "SeaTemp"
	| "SeaSeasonalIce"
	| "SeaPermIce"
