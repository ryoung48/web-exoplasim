import { FOURIER } from "@/model/climate/gcm/fourier"
import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type {
	GcmFieldSpec,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"
import { LEGENDRE } from "@/model/climate/gcm/legendre"
import { IMPLICIT_DIFFUSION } from "@/model/climate/gcm/physics/diffusion"
import type {
	GcmPrecipitationRequest,
	GcmPrecipitationTablesRequest,
} from "@/model/climate/gcm/physics/precipitation/types"
import columnCode from "@/model/climate/gcm/physics/precipitation/wgsl/column.wgsl?raw"
import kuoCode from "@/model/climate/gcm/physics/precipitation/wgsl/kuo.wgsl?raw"
import mkcloudsCode from "@/model/climate/gcm/physics/precipitation/wgsl/mkclouds.wgsl?raw"
import mkdcaCode from "@/model/climate/gcm/physics/precipitation/wgsl/mkdca.wgsl?raw"
import limitCode from "@/model/climate/gcm/physics/precipitation/wgsl/mkdca-limit.wgsl?raw"
import mklspCode from "@/model/climate/gcm/physics/precipitation/wgsl/mklsp.wgsl?raw"
import mkrainCode from "@/model/climate/gcm/physics/precipitation/wgsl/mkrain.wgsl?raw"
import saturationCode from "@/model/climate/gcm/physics/precipitation/wgsl/saturation.wgsl?raw"
import { GPU_MATH } from "@/model/shared/gpu/math"

// rainini's rcrit floor: stratiform cloud needs at least 85% humidity.
const RCRIT_MIN = 0.85

const LEVELS = ["icclev", "dprcl", "dprll", "dprscl", "dprsll"].concat([
	"dca_dtdt",
	"dca_dqdt",
])
const SURFACE = ["dprc", "dprl", "dprs", "dqvi", "icctot", "dca_limited"]

// rainmod's state, plus mkdca's per-column results before the global
// pass-limit check.
function fields(levels: number): GcmFieldSpec[] {
	return [
		{ name: "dqt", shape: "grid", count: levels + 1 },
		{ name: "fdqt", shape: "fourier", count: levels },
		...LEVELS.map((name) => ({ name, shape: "grid" as const, count: levels })),
		...SURFACE.map((name) => ({ name, shape: "grid" as const, count: 1 })),
		{ name: "dca_skip", shape: "table", count: 1 },
	]
}

// rainini's rcrit and kuo's dry-adiabatic factor (σ_l / σ_l+1)^κ, in f64.
// kuo, mkshallow and mkdca also read SURFACE_FLUX's σ^κ, σh^κ and 1/Δσ.
function tables({
	sigma,
	akap,
	rcritmod,
	rcritslope,
}: GcmPrecipitationTablesRequest): GcmTableValues {
	const levels = sigma.length
	return {
		rcrit: Float64Array.from(
			sigma,
			(value, l) =>
				Math.max(RCRIT_MIN, Math.max(value, 1 - value)) *
				rcritmod *
				(1 - (2 * rcritslope * (levels / 2 - (l + 1))) / levels),
		),
		kuo_zfac: Float64Array.from(
			sigma.subarray(0, levels - 1),
			(value, l) => (value / sigma[l + 1]) ** akap,
		),
	}
}

// rainmod's rainstep: mkdqtgp's transforms, kuo with mkshallow, mkdca and
// its global pass limit, then mklsp, mkrain and mkclouds per column.
async function kernels({
	context,
	constants,
}: GcmPrecipitationRequest): Promise<GcmKernel[]> {
	const { latitudes, longitudes, levels } = context.state.dimensions
	const THREADS = latitudes * longitudes
	const saturation = {
		RDBRV: constants.rdbrv,
		RA1: constants.ra1,
		RA2: constants.ra2,
		RA4: constants.ra4,
		TMELT: constants.tmelt,
		MOIST: 1 / constants.rdbrv - 1,
	}
	const physical = {
		DELTSEC2: constants.deltsec2,
		GA: constants.ga,
		GASCON: constants.gascon,
		ACPD: constants.acpd,
		ADV: constants.adv,
		ALV: constants.alv,
		ALS: constants.als,
	}
	return Promise.all([
		LEGENDRE.inverse({
			context,
			source: "sqt",
			target: "fdqt",
			planes: levels,
			table: "legendre_qi",
		}),
		FOURIER.inverse({ context, source: "fdqt", target: "dqt", planes: levels }),
		KERNEL.pipeline({
			context,
			label: "kuo",
			code: [
				GPU_MATH.PRECISE,
				IMPLICIT_DIFFUSION.CODE,
				saturationCode,
				kuoCode,
			].join("\n"),
			constants: {
				THREADS,
				...saturation,
				...physical,
				PSURF: constants.psurf,
				WW: constants.ww,
				RHBETA: constants.rhbeta,
				NBETA: constants.nbeta,
				PDEEP: constants.pdeep,
				PDEEPTH: constants.pdeepth,
				RKSHALLOW: constants.rkshallow,
			},
		}),
		KERNEL.pipeline({
			context,
			label: "mkdca",
			code: mkdcaCode,
			constants: { THREADS, DELTSEC2: constants.deltsec2 },
		}),
		KERNEL.pipeline({
			context,
			label: "mkdca limit",
			code: limitCode,
			constants: { THREADS: KERNEL.WORKGROUP_SIZE },
		}),
		KERNEL.pipeline({
			context,
			label: "rain column",
			code: [
				GPU_MATH.PRECISE,
				saturationCode,
				mklspCode,
				mkrainCode,
				mkcloudsCode,
				columnCode,
			].join("\n"),
			constants: {
				THREADS,
				...saturation,
				...physical,
				GAMMA: constants.gamma,
				ZRFAC: constants.solarDay * 1000,
				CLWFAC: constants.clwfac,
				CLWCRIT1: constants.clwcrit1,
				CLWCRIT2: constants.clwcrit2,
			},
		}),
	])
}

export const PRECIPITATION = {
	fields,
	tables,
	kernels,
}
