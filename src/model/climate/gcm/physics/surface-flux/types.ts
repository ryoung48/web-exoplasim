import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

// pumamod and fluxmod_nl values the surface fluxes and vertical diffusion
// read. fluxmod's switches (nvdiff, nshfl, nevap, nstress) are 1 and ntsa
// is 2 for every page configuration; only that path is ported.
export interface GcmSurfaceFluxConstants {
	rdbrv: number
	gascon: number
	ga: number
	acpd: number
	adv: number
	deltsec: number
	deltsec2: number
	ra2: number
	ra4: number
	tmelt: number
	alv: number
	als: number
	zumin: number
	vdiffB: number
	vdiffC: number
	vdiffD: number
	ndheat: boolean
}

export interface GcmSurfaceFluxTablesRequest {
	sigma: Float64Array
	sigmah: Float64Array
	akap: number
	gascon: number
	ga: number
	vdiffLamm: number
	vdiffD: number
}

export interface GcmSurfaceFluxRequest {
	context: GcmKernelContext
	constants: GcmSurfaceFluxConstants
}
