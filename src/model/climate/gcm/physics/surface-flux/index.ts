import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type {
	GcmFieldSpec,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"
import { IMPLICIT_DIFFUSION } from "@/model/climate/gcm/physics/diffusion"
import type {
	GcmSurfaceFluxRequest,
	GcmSurfaceFluxTablesRequest,
} from "@/model/climate/gcm/physics/surface-flux/types"
import surflxCode from "@/model/climate/gcm/physics/surface-flux/wgsl/surflx.wgsl?raw"
import vdiffCode from "@/model/climate/gcm/physics/surface-flux/wgsl/vdiff.wgsl?raw"

// Surface fields fluxmod reads (dz0, dls, drhs, dwatc) and writes.
const SURFACE_FIELDS = [
	...["dz0", "dls", "drhs", "dwatc", "dtsa", "dtransh", "dtransm"],
	...["dtaux", "dtauy", "dust3", "dshfl", "dshdt", "devap", "dlhfl", "dlhdt"],
]

function fields(): GcmFieldSpec[] {
	return SURFACE_FIELDS.map((name) => ({ name, shape: "grid", count: 1 }))
}

const VONKARMAN = 0.4
// vdiff's reference temperature for level heights (K).
const ZTSCAL = 250

// Level constants of surflx and vdiff, in f64: they depend only on the
// sigma levels and fluxmod_nl, and WGSL's pow is coarser than f32 libm.
function tables({
	sigma,
	sigmah,
	akap,
	gascon,
	ga,
	vdiffLamm,
	vdiffD,
}: GcmSurfaceFluxTablesRequest): GcmTableValues {
	const levels = sigma.length
	const zlamh = vdiffLamm * Math.sqrt(3 * vdiffD * 0.5)
	const result: GcmTableValues = {
		flux_sigfac: Float64Array.of(sigma[levels - 1] ** -akap),
		flux_lnsig: Float64Array.of(Math.log(sigma[levels - 1])),
		vdiff_skap: Float64Array.from(sigma, (value) => value ** akap),
		vdiff_skaph: Float64Array.from(sigmah, (value) => value ** akap),
		vdiff_mixh2: new Float64Array(levels),
		vdiff_mixm2: new Float64Array(levels),
		vdiff_rdsig: new Float64Array(levels),
		vdiff_sigmah3: new Float64Array(levels),
		vdiff_kfac: new Float64Array(levels),
	}
	for (let l = 0; l < levels - 1; l++) {
		const zzlev = (-gascon * ZTSCAL * Math.log(sigmah[l])) / ga
		const zdz = (gascon * ZTSCAL * Math.log(sigma[l + 1] / sigma[l])) / ga
		const zmixh = (zlamh * VONKARMAN * zzlev) / (zlamh + VONKARMAN * zzlev)
		const zmixm =
			(vdiffLamm * VONKARMAN * zzlev) / (vdiffLamm + VONKARMAN * zzlev)
		const zrdsig = 1 / (sigma[l + 1] - sigma[l])
		result.vdiff_mixh2[l] = zmixh * zmixh
		result.vdiff_mixm2[l] = zmixm * zmixm
		result.vdiff_rdsig[l] = zrdsig
		result.vdiff_sigmah3[l] = sigmah[l] * sigmah[l] * sigmah[l] * zrdsig
		const ratio = (((zzlev + zdz) / zzlev) ** (1 / 3) - 1) / zdz
		result.vdiff_kfac[l] = Math.sqrt(ratio ** 3 / zzlev)
	}
	return result
}

// fluxmod's fluxstep: surflx (transfer coefficients, implicit stress,
// sensible heat and evaporation), then vdiff.
function kernels({
	context,
	constants,
}: GcmSurfaceFluxRequest): Promise<GcmKernel[]> {
	const { latitudes, longitudes } = context.state.dimensions
	const shared = {
		THREADS: latitudes * longitudes,
		RDBRV: constants.rdbrv,
		GASCON: constants.gascon,
		GA: constants.ga,
		ACPD: constants.acpd,
		ADV: constants.adv,
		DELTSEC2: constants.deltsec2,
		ZUMIN: constants.zumin,
		VDIFF_B: constants.vdiffB,
		VDIFF_C: constants.vdiffC,
		VDIFF_D: constants.vdiffD,
		NDHEAT: constants.ndheat ? 1 : 0,
	}
	return Promise.all([
		KERNEL.pipeline({
			context,
			label: "surflx",
			code: surflxCode,
			constants: {
				...shared,
				DELTSEC: constants.deltsec,
				RA2: constants.ra2,
				RA4: constants.ra4,
				TMELT: constants.tmelt,
				ALV: constants.alv,
				ALS: constants.als,
			},
		}),
		KERNEL.pipeline({
			context,
			label: "vdiff",
			code: IMPLICIT_DIFFUSION.CODE + vdiffCode,
			constants: shared,
		}),
	])
}

export const SURFACE_FLUX = {
	fields,
	tables,
	kernels,
}
