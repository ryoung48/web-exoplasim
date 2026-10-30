import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import type { GcmStormRequest } from "@/model/climate/gcm/physics/storm/types"
import code from "@/model/climate/gcm/physics/storm/wgsl/storm.wgsl?raw"

const FIELDS = [
	"capen",
	"lnb",
	"mpoti",
	"chim",
	"laav",
	"venti",
	"vrmpi",
	"gpi",
	"shear",
] as const

function fields(): GcmFieldSpec[] {
	return FIELDS.map((name) => ({ name, shape: "grid", count: 1 }))
}

async function kernels({
	context,
	constants,
}: GcmStormRequest): Promise<GcmKernel[]> {
	if (constants.NSTORMDIAG <= 0) return []
	const { latitudes, longitudes } = context.state.dimensions
	return [
		await KERNEL.pipeline({
			context,
			label: "hurricanestep",
			code,
			constants: {
				THREADS: latitudes * longitudes,
				RD: constants.RD,
				OMEGA: constants.OMEGA,
				CKCD: constants.CKCD,
				VITHRESH: constants.VITHRESH,
			},
		}),
	]
}

export const STORM = { fields, kernels }
