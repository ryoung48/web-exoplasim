import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

// pumamod and rainmod_nl values rainstep reads. gamma is rainini's: 0.007
// at T42 with 10 levels, the namelist's 0.01 otherwise.
export interface GcmPrecipitationConstants {
	deltsec2: number
	psurf: number
	ww: number
	ga: number
	gascon: number
	acpd: number
	adv: number
	alv: number
	als: number
	rdbrv: number
	ra1: number
	ra2: number
	ra4: number
	tmelt: number
	rhbeta: number
	nbeta: number
	pdeep: number
	pdeepth: number
	rkshallow: number
	gamma: number
	solarDay: number
	clwfac: number
	clwcrit1: number
	clwcrit2: number
}

export interface GcmPrecipitationTablesRequest {
	sigma: Float64Array
	akap: number
	rcritmod: number
	rcritslope: number
}

export interface GcmPrecipitationRequest {
	context: GcmKernelContext
	constants: GcmPrecipitationConstants
}
