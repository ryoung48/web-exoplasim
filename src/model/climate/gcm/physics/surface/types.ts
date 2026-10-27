import type { GcmMonthInterpolation } from "@/model/climate/gcm/calendar/types"
import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

// Pipeline constants under the WGSL override names, which are the Fortran
// names upper-cased.
export interface GcmSoilConstants {
	DELTSEC: number
	TMELT: number
	ALS: number
	ALV: number
	SICECAP: number
	SOILCAP: number
	SICEDIFF: number
	SOILDIFF: number
	SNOWCAP: number
	SNOWDIFF: number
	RHOSNOW: number
	DZTOP: number
	DSMAX: number
}

export interface GcmLandSurfaceConstants {
	DELTSEC: number
	TMELT: number
	RDBRV: number
	RA1: number
	RA2: number
	RA4: number
	ALBSMAX: number
	ALBSMIN: number
	ALBSMAXF: number
	ALBSMINF: number
	ALBSMAX1: number
	ALBSMIN1: number
	ALBSMAXF1: number
	ALBSMINF1: number
	ALBSMAX2: number
	ALBSMIN2: number
	ALBSMAXF2: number
	ALBSMINF2: number
	ALBGMAX: number
	ALBGMIN: number
	ALBGMAX1: number
	ALBGMIN1: number
	ALBGMAX2: number
	ALBGMIN2: number
	DRHSFULL: number
	NWETSOIL: number
	WSMAX: number
	ALBLAND: number
	ALBLANDMAX: number
	DGROUNDALB1: number
	DGROUNDALB2: number
	DOCEANALB1: number
	DOCEANALB2: number
}

export interface GcmVegetationConstants {
	NVEG: number
	RLUE: number
	CO2CONV: number
	TAU_VEG: number
	TAU_SOIL: number
	VWS_CRIT: number
	Q10: number
	ZLAIMAX: number
	ZLAIMIN: number
	VALB_MIN: number
	VALB_MAX: number
	VSALB_MIN: number
	VWMAX_MAX: number
	VWMAX_MIN: number
	VZ0_MIN: number
	CVEG_A: number
	CVEG_C: number
	CVEG_D: number
	CVEG_F: number
	CVEG_K: number
	CVEG_L: number
	CT_CRIT: number
	CO2_REF: number
	CO2_COMP: number
	CO2_SENS: number
	NCVEG: number
}

export interface GcmIceConstants {
	XDT: number
	XMIND: number
	XMAXD: number
	CICEMIN: number
	THICEC: number
	TFREEZE: number
	TMELT: number
	CRHOI: number
	CRHOS: number
	CRHOSN: number
	CPI: number
	CKAPI: number
	CKAPSN: number
	CLFI: number
	CLFSN: number
}

export interface GcmOceanConstants {
	DTMIX: number
	CPS: number
}

export interface GcmSeaConstants {
	RDBRV: number
	RA1: number
	RA2: number
	RA4: number
	GASCON: number
	GA: number
	CHARNOCK: number
	DZ0SEA: number
	DZ0ICE: number
	DRHSSEA: number
	DRHSICE: number
	ALBSEA: number
	ALBICE: number
	DICEALBMX1: number
	DICEALBMX2: number
	DICEALBMN1: number
	DICEALBMN2: number
}

export interface GcmSurfaceConstants {
	soil: GcmSoilConstants
	land: GcmLandSurfaceConstants
	vegetation: GcmVegetationConstants
	nglacier: boolean
	ice: GcmIceConstants
	ocean: GcmOceanConstants
	sea: GcmSeaConstants
}

export interface GcmSurfaceRequest {
	context: GcmKernelContext
	constants: GcmSurfaceConstants
}

// momint at nstep (icemod's xclssto) and at nstep + 1 (every other
// climatology).
export interface GcmSurfaceStepRequest {
	now: GcmMonthInterpolation
	next: GcmMonthInterpolation
}
