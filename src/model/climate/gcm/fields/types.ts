import type { GcmSnapshot } from "@/model/climate/gcm/types"

export type GcmFieldId =
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
	| "celsius"
	| "metersPerSecond"
	| "percent"
	| "millimetersPerDay"
	| "hectopascals"
	| "kilogramsPerSquareMeter"
	| "centimeters"
	| "millimeters"
	| "wattsPerSquareMeter"

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
