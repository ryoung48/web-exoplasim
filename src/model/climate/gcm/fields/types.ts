import type { GcmSnapshot } from "@/model/climate/gcm/types"

export type GcmLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type GcmAtmosphereVariable =
	| "Temperature"
	| "Wind"
	| "Humidity"
	| "Cloud"

export interface GcmAtmosphereSelection {
	variable: GcmAtmosphereVariable
	level: GcmLevel
}

export type GcmFieldId =
	| "netPrimaryProduction"
	| "solarZenithCosine"
	| "diurnalTemperatureRange"
	| "dailyTemperatureRangeSum"
	| "dailyTemperatureRangeDays"
	| "surfaceTemperatureMin"
	| "surfaceTemperatureMax"
	| "convectivePrecipitation"
	| "largeScalePrecipitation"
	| "toaShortwave"
	| "toaLongwave"
	| "surfaceShortwave"
	| "surfaceLongwave"
	| "sensibleHeatFlux"
	| "latentHeatFlux"
	| "seaLevelPressure"
	| "snowfall"
	| "snowmelt"
	| "seaIceThickness"
	| "glacierCover"
	| `layer${"Temperature" | "WindU" | "WindV" | "Humidity" | "Cloud"}${GcmLevel}`
	| "evaporation"
	| "runoff"
	| "forestCover"
	| "leafAreaIndex"
	| "surfaceTemperature"
	| "airTemperature"
	| "windU"
	| "windV"
	| "cloudCover"
	| "precipitation"
	| "surfacePressure"
	| "waterVapor"
	| "seaIce"
	| "snowDepth"
	| "soilWater"
	| "albedo"
	| "jetU"
	| "jetV"
	| "outgoingLongwave"
	| "landFraction"
	| "toaNetRadiation"
	| "surfaceNetHeat"

export type GcmMapMode =
	| "netPrimaryProduction"
	| "solarZenithCosine"
	| "diurnalTemperatureRange"
	| "convectivePrecipitation"
	| "largeScalePrecipitation"
	| "toaShortwave"
	| "toaLongwave"
	| "surfaceShortwave"
	| "surfaceLongwave"
	| "sensibleHeatFlux"
	| "latentHeatFlux"
	| "seaLevelPressure"
	| "snowfall"
	| "snowmelt"
	| "seaIceThickness"
	| "glacierCover"
	| `layer${GcmAtmosphereVariable}${GcmLevel}`
	| "relativeHumidity"
	| "evaporation"
	| "runoff"
	| "forestCover"
	| "leafAreaIndex"
	| "toaNetRadiation"
	| "surfaceNetHeat"
	| "surfaceTemperature"
	| "airTemperature"
	| "wind"
	| "jet"
	| "cloudCover"
	| "precipitation"
	| "surfacePressure"
	| "waterVapor"
	| "seaIce"
	| "snowDepth"
	| "soilWater"
	| "albedo"
	| "outgoingLongwave"

export type GcmDisplayUnit =
	| "gramsCarbonPerSquareMeterPerDay"
	| "celsiusDelta"
	| "celsius"
	| "metersPerSecond"
	| "percent"
	| "millimetersPerDay"
	| "hectopascals"
	| "kilogramsPerSquareMeter"
	| "centimeters"
	| "millimeters"
	| "wattsPerSquareMeter"
	| "dimensionless"

export interface GcmModeDefinition {
	mode: GcmMapMode
	label: string
	unit: GcmDisplayUnit
	min: number
	max: number
}

export interface GcmModeRequest {
	snapshot: GcmSnapshot
	mode: GcmMapMode
}

export interface GcmFieldRequest {
	snapshot: GcmSnapshot
	field: GcmFieldId
}

export interface GcmScaling {
	values: Float32Array
	scale: number
	offset: number
}

export interface GcmVectorField {
	u: Float32Array
	v: Float32Array
}
