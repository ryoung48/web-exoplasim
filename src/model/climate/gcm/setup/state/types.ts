import type { GcmDynamicsSetup } from "@/model/climate/gcm/dynamics/setup/types"
import type { GcmPumamod } from "@/model/climate/gcm/setup/pumamod/types"

export interface GcmSpectralStateRequest {
	pumamod: GcmPumamod
	dynamics: GcmDynamicsSetup
	truncation: number
	// system_clock's count, which seeds the noise when the namelist's seed
	// is zero (the Fortran's behaviour); unused otherwise.
	clock: number
}

// initfd's state: a resting atmosphere at the restoration profile, with
// noise in ln(ps) and planetary vorticity. Fortran-ordered (NESP, NLEV).
export interface GcmSpectralState {
	sr: Float64Array
	sp: Float64Array
	spm: Float64Array
	st: Float64Array
	stm: Float64Array
	sz: Float64Array
	szm: Float64Array
	sd: Float64Array
	sdm: Float64Array
	sq: Float64Array
	sqm: Float64Array
}

export interface GcmNoiseRequest {
	sp: Float64Array
	truncation: number
	kick: number
	seed: ReadonlyArray<number>
}
