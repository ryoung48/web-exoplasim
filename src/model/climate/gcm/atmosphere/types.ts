export type GcmGas =
	| "H2"
	| "He"
	| "N2"
	| "O2"
	| "Ar"
	| "Ne"
	| "Kr"
	| "CO2"
	| "H2O"

export type GcmAtmosphereMode = "partialPressures" | "pressureAndGasConstant"

export interface GcmGasDefinition {
	id: GcmGas
	label: string
	molarMass: number
	nativeFraction: number
}

export interface GcmAtmosphereConfig {
	mode: GcmAtmosphereMode
	partialPressures: Record<GcmGas, number | null>
	pressureBar: number | null
	gasConstant: number | null
	ozone: boolean
}

export interface GcmAtmosphereValues {
	warnings: string[]
	pressureBar: number
	gasConstant: number
	co2Ppm: number
	meanMolarMass: number
	specifiedPressureBar: number
}

export interface GcmCo2Change {
	config: GcmAtmosphereConfig
	co2Ppm: number | null
}

export type GcmAtmosphereResult =
	| { ok: true; values: GcmAtmosphereValues }
	| { ok: false; message: string }
