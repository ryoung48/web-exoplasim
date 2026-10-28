import implicitCode from "@/model/climate/gcm/physics/diffusion/wgsl/implicit.wgsl?raw"

// WGSL tridiagonal solves shared by fluxmod's vdiff and rainmod's
// mkshallow, prepended to their kernels.
export const IMPLICIT_DIFFUSION = {
	CODE: implicitCode,
}
