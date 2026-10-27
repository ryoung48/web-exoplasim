import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import { GLACIER } from "@/model/climate/gcm/physics/glacier"
import { LAND } from "@/model/climate/gcm/physics/land"
import { OCEAN } from "@/model/climate/gcm/physics/ocean"
import { SEA } from "@/model/climate/gcm/physics/sea"
import { SEA_ICE } from "@/model/climate/gcm/physics/sea-ice"
import type {
	GcmSurfaceRequest,
	GcmSurfaceStepRequest,
} from "@/model/climate/gcm/physics/surface/types"
import { VEGETATION } from "@/model/climate/gcm/physics/vegetation"
import { REDUCTION } from "@/model/climate/gcm/reduction"
import { GPU_MATH } from "@/model/shared/gpu/math"

// pumamod's surface fields that land, sea and glacier all write.
const SHARED = [
	"dforest",
	"dglac",
	"dwmax",
	"drunoff",
	"dsnow",
	"dsmelt",
].concat(["dsndch", "dtsoil", "dtd2", "dtd3", "dtd4", "dtd5", "diced", "dmld"])

// SURFACE_STEP: momint's month, neighbour and weight at nstep, then at
// nstep + 1, written by the CPU each step.
const STEP_VALUES = 6

function fields(): GcmFieldSpec[] {
	return [
		...SHARED.map((name) => ({ name, shape: "grid" as const, count: 1 })),
		{ name: "surface_step", shape: "table", count: STEP_VALUES },
		...LAND.fields(),
		...VEGETATION.fields(),
		...SEA_ICE.fields(),
		...OCEAN.fields(),
		...SEA.fields(),
	]
}

function step({ now, next }: GcmSurfaceStepRequest): Float64Array {
	return Float64Array.of(
		now.month,
		now.neighbour,
		now.weight,
		next.month,
		next.neighbour,
		next.weight,
	)
}

// surfmod's surfstep with naqua = 0 and sea points present: landstep
// (soil, river routing, surface with vegstep and glacier albedo),
// glacierstep, then seastep with icestep and oceanstep every step.
// Kernels with Fortran's atan, exp, log or pow get GPU_MATH's versions.
function kernels({
	context,
	constants,
}: GcmSurfaceRequest): Promise<GcmKernel[]> {
	const { latitudes, longitudes } = context.state.dimensions
	const THREADS = latitudes * longitudes
	const { soil, land, vegetation, ice, ocean, sea } = constants
	// simba recomputes these every step from its namelist values.
	const { CVEG_D, ...growth } = vegetation
	const { THICEC, ...iceGrowth } = ice
	return Promise.all([
		KERNEL.pipeline({
			context,
			label: "land soil",
			code: GPU_MATH.PRECISE + LAND.SOIL_CODE,
			constants: { THREADS, ...soil },
		}),
		KERNEL.pipeline({
			context,
			label: "river routing",
			code: LAND.ROUTING_CODE,
			constants: { THREADS },
		}),
		KERNEL.pipeline({
			context,
			label: "land surface",
			code: [
				GPU_MATH.PRECISE,
				VEGETATION.CODE,
				GLACIER.CODE,
				LAND.SURFACE_CODE,
			].join("\n"),
			constants: {
				THREADS,
				...land,
				...growth,
				CVEG_E: Math.atan(CVEG_D),
				CVEG_G: Math.atan(-vegetation.CVEG_F),
				NGLACIER: constants.nglacier ? 1 : 0,
			},
		}),
		KERNEL.pipeline({
			context,
			label: "sea ice",
			code: SEA_ICE.CODE,
			constants: { THREADS, ...iceGrowth },
		}),
		REDUCTION.sum({
			context,
			label: "getiflx sums",
			first: "ice_part1",
			second: "ice_part2",
			target: "ice_sums",
		}),
		KERNEL.pipeline({
			context,
			label: "sea",
			code: [GPU_MATH.PRECISE, SEA_ICE.FINISH_CODE, OCEAN.CODE, SEA.CODE].join(
				"\n",
			),
			constants: {
				THREADS,
				...sea,
				XDT: ice.XDT,
				CLFSN: ice.CLFSN,
				THICEC,
				TMELT: ice.TMELT,
				TFREEZE: ice.TFREEZE,
				CRHOS: ice.CRHOS,
				DTMIX: ocean.DTMIX,
				CPS: ocean.CPS,
				DOCEANALB1: land.DOCEANALB1,
				DOCEANALB2: land.DOCEANALB2,
			},
		}),
	])
}

export const SURFACE = {
	fields,
	step,
	kernels,
}
