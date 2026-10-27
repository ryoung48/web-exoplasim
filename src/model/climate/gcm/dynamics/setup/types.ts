import type { GcmGrid } from "@/model/climate/gcm/grid/types"

// pumamod values after readnl and planet_ini, as initpm receives them.
// Time scales are in seconds or (when below one timestep) days; t0 in K.
export interface GcmDynamicsSetupInput {
	truncation: number
	levels: number
	neqsig: number
	restim: ReadonlyArray<number>
	tfrc: ReadonlyArray<number>
	tdissd: ReadonlyArray<number>
	tdissz: ReadonlyArray<number>
	tdisst: ReadonlyArray<number>
	tdissq: ReadonlyArray<number>
	ndel: ReadonlyArray<number>
	nhdiff: number
	dayLengthS: number
	stepsPerDay: number
	t0: ReadonlyArray<number>
	dtns: number
	dtep: number
	dttrp: number
	ct: number
	akap: number
}

// Fortran-ordered: matrices column-major like g(row, column), spectral
// arrays as real coefficients 2w, 2w + 1 per level.
export interface GcmDynamicsSetup {
	sigmah: Float64Array
	sigma: Float64Array
	dsigma: Float64Array
	rdsig: Float64Array
	damp: Float64Array
	tfrc: Float64Array
	tdissd: Float64Array
	tdissz: Float64Array
	tdisst: Float64Array
	tdissq: Float64Array
	sak: Float64Array
	nindex: Float64Array
	spnorm: Float64Array
	t0: Float64Array
	dtns: number
	dtep: number
	dttrp: number
	tkp: Float64Array
	t01s2: Float64Array
	g: Float64Array
	c: Float64Array
	tau: Float64Array
}

export interface GcmSemiImplicitRequest {
	setup: GcmDynamicsSetup
	truncation: number
	// Nondimensional timestep (TWOPI / ntspd, halved per start-up step).
	delt: number
}

export interface GcmDynamicsTablesRequest {
	setup: GcmDynamicsSetup
	bm1: Float64Array
	rcsq: Float64Array
}

export interface GcmLatitudeFactorsRequest {
	grid: GcmGrid
}

export interface GcmTimeScales {
	values: ReadonlyArray<number>
	threshold: number
	day: number
}

export interface GcmSemiImplicitInit {
	setup: GcmDynamicsSetup
	akap: number
}

// setzt's inputs besides initpm's: the planet's lapse rate (K/m), surface
// temperature (K) and tropopause height (m), and the tidally locked
// substellar–antistellar difference (K) at its longitude (degrees).
export interface GcmRestorationRequest {
	setup: GcmDynamicsSetup
	truncation: number
	gascon: number
	ga: number
	ct: number
	alr: number
	tgr: number
	dtrop: number
	dttl: number
	fixedlon: number
}

export interface GcmMatrixInverse {
	matrix: Float64Array
	size: number
}
