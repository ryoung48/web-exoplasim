export interface GcmSpectrumRequest {
	starTemperatureK: number
	// radmod_nl's minwavel in metres: no flux below it.
	minWavelengthM: number
	// nsimplealbedo: one broadband albedo for both bands.
	simpleAlbedo: boolean
}

// A surface's albedo in each band: below and above 0.75 µm.
export type GcmBandAlbedo = [number, number]

// solarini's results, under radmod's names.
export interface GcmSpectrum {
	zsolar1: number
	zsolar2: number
	rcoeff: number
	dsnowalb: GcmBandAlbedo
	dsnowalbmn: GcmBandAlbedo
	dsnowalbmx: GcmBandAlbedo
	dicealbmn: GcmBandAlbedo
	dicealbmx: GcmBandAlbedo
	dglacalbmn: GcmBandAlbedo
	dgroundalb: GcmBandAlbedo
	doceanalb: GcmBandAlbedo
}

export interface GcmPlanckPoint {
	wavelength: number
	// The λ⁵ factor in the units solarini uses for this grid.
	scaled: number
	// hc/(kT), scaled to the grid's wavelength unit.
	constant: number
}

export interface GcmTrapezoid {
	values: number[]
	at: number[]
	k: number
}
