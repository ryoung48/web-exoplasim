import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type {
	GcmFieldSpec,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"
import type {
	GcmRadiationRequest,
	GcmRadiationStepRequest,
	GcmRadiationTablesRequest,
	GcmSolarKernelRequest,
} from "@/model/climate/gcm/physics/radiation/types"
import lwrCode from "@/model/climate/gcm/physics/radiation/wgsl/lwr.wgsl?raw"
import mko3Code from "@/model/climate/gcm/physics/radiation/wgsl/mko3.wgsl?raw"
import radstepCode from "@/model/climate/gcm/physics/radiation/wgsl/radstep.wgsl?raw"
import solangCode from "@/model/climate/gcm/physics/radiation/wgsl/solang.wgsl?raw"
import swrCode from "@/model/climate/gcm/physics/radiation/wgsl/swr.wgsl?raw"
import { GPU_MATH } from "@/model/shared/gpu/math"

// pumamod's PI, which radmod's solang and mko3 use.
const PI = 3.14159265359
const TWOPI = PI + PI
const MINUTES_PER_DAY = 1440
// swr's zenith-angle cosine of diffuse light.
const ZMU00 = 0.5
// lwr's molar masses of air and CO2 (kg/mol) and CO2 density (kg/m³).
const ZMMAIR = 0.0289644
const ZMMCO2 = 0.0440098
const ZRCO2 = 1.9635

const HALF_LEVELS = ["dcc", "dql", "dfu", "dfd", "dftu", "dftd"].concat([
	"dswfl",
	"dlwfl",
	"dflux",
])
const LEVELS = ["dqo3", "dqco2", "dtdtswr", "dtdtlwr", "dconv"]
const SURFACE = ["gmu0", "dalb", "dicec"]
// sin and cos of the declination, zmins·zrtim, gdist2 and mko3's seasonal
// cos(2π(zcday − toffo3)), written by the CPU each step.
const STEP_VALUES = 5

function fields(levels: number): GcmFieldSpec[] {
	return [
		...HALF_LEVELS.map((name) => ({
			name,
			shape: "grid" as const,
			count: levels + 1,
		})),
		...LEVELS.map((name) => ({ name, shape: "grid" as const, count: levels })),
		...SURFACE.map((name) => ({ name, shape: "grid" as const, count: 1 })),
		{ name: "dsalb", shape: "grid", count: 2 },
		{ name: "radiation_step", shape: "table", count: STEP_VALUES },
	]
}

// Latitude and level constants in f64. rad_lnsig is the log-pressure
// thickness radstep and mko3 turn into layer heights; lwr_zzf1 and
// lwr_zzf3 are lwr's per-level absorber and cloud-emissivity factors.
function tables({
	grid,
	sigma,
	sigmah,
	dsigma,
	ga,
	acllwr,
}: GcmRadiationTablesRequest): GcmTableValues {
	const levels = sigma.length
	const lnsig = new Float64Array(levels)
	lnsig[0] = Math.log(sigma[0] / sigmah[0]) * 0.5
	for (let l = 1; l < levels; l++)
		lnsig[l] = Math.log(sigmah[l - 1] / sigmah[l])
	return {
		sid: Float64Array.from(grid.latitudeSines),
		cola: Float64Array.from(grid.latitudeSines, (s) => Math.sqrt(1 - s * s)),
		rad_lnsig: lnsig,
		lwr_zzf1: Float64Array.from(
			sigma,
			(value, l) => (value * dsigma[l]) / ga / 100000,
		),
		lwr_zzf3: Float64Array.from(
			dsigma,
			(value) => (-1.66 * acllwr * 1000 * value) / ga,
		),
	}
}

function step({
	solar,
	rotationSpeed,
	toffo3,
	fixedSun,
	keplerian,
}: GcmRadiationStepRequest): Float64Array {
	const declination = fixedSun ? fixedSun.declinationRad : solar.declination
	const phase = fixedSun
		? (1 - fixedSun.longitudeDeg / 360) * TWOPI
		: (solar.minutes * rotationSpeed * TWOPI) / MINUTES_PER_DAY
	return Float64Array.of(
		Math.sin(declination),
		Math.cos(declination),
		phase - (keplerian ? solar.rightAscension : 0),
		solar.distanceFactor,
		Math.cos(TWOPI * (solar.calendarDay - toffo3)),
	)
}

// lwr's absorptivity fits evaluated at their branch points.
function absorptivityOffsets(): Record<string, number> {
	const zao30 = 0.209 * 7e-5 ** 0.436
	const zco20 = 0.0676 * 0.01022 ** 0.421
	const zh2o0a = 0.846 * 3.59e-5 ** 0.243
	const zh2o0 = 0.832 * 0.0286 ** 0.26
	return {
		ZAO30: zao30,
		ZCO20: zco20,
		ZH2O0A: zh2o0a,
		ZH2O0: zh2o0,
		ZAO3C: 0.209 * (0.01 + 7e-5) ** 0.436 - zao30 - 0.0212 * Math.log10(0.01),
		ZACO2C: 0.0676 * 1.01022 ** 0.421 - zco20,
		ZAH2OC:
			0.846 * (0.01 + 3.59e-5) ** 0.243 - zh2o0a - 0.24 * Math.log10(0.02),
		ZTH2OC:
			1 -
			(0.832 * (2 + 0.0286) ** 0.26 - zh2o0) +
			0.1196 * Math.log(2 - 0.6931),
	}
}

// radmod's radstep: solang, mko3, swr, lwr, then the heating rates.
function zenith({
	context,
	dawnDeg,
	synchronous,
}: GcmSolarKernelRequest): Promise<GcmKernel> {
	const { latitudes, longitudes } = context.state.dimensions
	return KERNEL.pipeline({
		context,
		label: "solang",
		code: solangCode,
		constants: {
			THREADS: latitudes * longitudes,
			NFIXED: synchronous ? 1 : 0,
			PI,
			TWOPI,
			ZRLON: TWOPI / longitudes,
			ZDAWN: Math.sin((dawnDeg * PI) / 180),
		},
	})
}

function kernels({
	context,
	constants,
}: GcmRadiationRequest): Promise<GcmKernel[]> {
	const { latitudes, longitudes } = context.state.dimensions
	const THREADS = latitudes * longitudes
	const physical = {
		GA: constants.ga,
		GASCON: constants.gascon,
	}
	return Promise.all([
		zenith({
			context,
			dawnDeg: constants.dawnDeg,
			synchronous: constants.synchronous,
		}),
		...(constants.ozone
			? [
					KERNEL.pipeline({
						context,
						label: "mko3",
						code: GPU_MATH.PRECISE + mko3Code,
						constants: {
							THREADS,
							...physical,
							A0O3: constants.a0o3,
							A1O3: constants.a1o3,
							ACO3: constants.aco3,
							BO3: constants.bo3,
							CO3: constants.co3,
							ZCONST: Math.exp(-constants.bo3 / constants.co3),
						},
					}),
				]
			: []),
		KERNEL.pipeline({
			context,
			label: "swr",
			code: GPU_MATH.PRECISE + swrCode,
			constants: {
				THREADS,
				GA: constants.ga,
				GSOL0: constants.gsol0,
				ZSOLAR1: constants.zsolar1,
				ZSOLAR2: constants.zsolar2,
				ZSOLARS1: constants.zsolars1,
				ZSOLARS2: constants.zsolars2,
				TSWR1: constants.tswr1,
				TSWR2: constants.tswr2,
				TSWR3: constants.tswr3,
				ZB3: (constants.tswr1 * Math.sqrt(ZMU00)) / ZMU00,
				ZB4: constants.tswr2 * Math.sqrt(ZMU00),
				ZB5: constants.tswr3 * ZMU00 * ZMU00,
				RCOEFF: constants.rcoeff,
				LN_DIFFUSE_RAYLEIGH: Math.log(1 - 0.144),
				NSTARTEMP: constants.nstartemp ? 1 : 0,
			},
		}),
		KERNEL.pipeline({
			context,
			label: "lwr",
			code: GPU_MATH.PRECISE + lwrCode,
			constants: {
				THREADS,
				SBK: constants.sbk,
				TH2OC: constants.th2oc,
				TPOFMT: constants.tpofmt,
				...absorptivityOffsets(),
				ZFCO2_ZZF2: (100 / ZRCO2) * (ZMMCO2 / ZMMAIR) * 1e-6,
			},
		}),
		KERNEL.pipeline({
			context,
			label: "radstep",
			code: radstepCode,
			constants: {
				THREADS,
				...physical,
				ACPD: constants.acpd,
				ADV: constants.adv,
			},
		}),
	])
}

export const RADIATION = {
	zenith,
	fields,
	tables,
	step,
	kernels,
}
