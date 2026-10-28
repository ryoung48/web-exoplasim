import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import type {
	GcmCarbonCycle,
	GcmCarbonCycleStep,
	GcmCarbonRequest,
} from "@/model/climate/gcm/physics/carbon/types"
import carbonstepCode from "@/model/climate/gcm/physics/carbon/wgsl/carbonstep.wgsl?raw"
import { GPU_MATH } from "@/model/shared/gpu/math"

// carbonmod's per-point precipitation and weathering with their yearly
// means, pumamod's CO2 (ppmv), and CARBON_STEP, the CPU's weathering flag.
function fields(): GcmFieldSpec[] {
	return [
		...["localprecip", "localavgprecip", "localweathering"]
			.concat(["localavgweather", "localavgtemps"])
			.map((name) => ({ name, shape: "grid" as const, count: 1 })),
		{ name: "co2", shape: "table", count: 1 },
		{ name: "carbon_step", shape: "table", count: 1 },
	]
}

// The counter after this step and whether this step weathers.
function cycle({ cstep, interval }: GcmCarbonCycle): GcmCarbonCycleStep {
	const next = cstep + 1
	return next === interval
		? { cstep: 0, weathers: true }
		: { cstep: next, weathers: false }
}

function kernels({
	context,
	constants,
}: GcmCarbonRequest): Promise<GcmKernel[]> {
	const { latitudes, longitudes } = context.state.dimensions
	return Promise.all([
		KERNEL.pipeline({
			context,
			label: "carbonstep",
			code: GPU_MATH.PRECISE + carbonstepCode,
			constants: { THREADS: latitudes * longitudes, ...constants },
		}),
	])
}

export const CARBON = {
	fields,
	cycle,
	kernels,
}
