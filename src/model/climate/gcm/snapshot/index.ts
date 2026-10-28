import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import { PRECIPITATION } from "@/model/climate/gcm/physics/precipitation"
import type { GcmSnapshotKernelRequest } from "@/model/climate/gcm/snapshot/types"
import packCode from "@/model/climate/gcm/snapshot/wgsl/pack.wgsl?raw"
import type { GcmLayerCount } from "@/model/climate/gcm/types"
import { GPU_MATH } from "@/model/shared/gpu/math"

// gcm_publish.f90's jet level: the full level nearest sigma 0.25.
const JET_SIGMA = 0.25

function fields(levels: number): GcmFieldSpec[] {
	return [
		{
			name: "snapshot",
			shape: "grid",
			count: GCM_FIELDS.fieldCount(levels as GcmLayerCount),
		},
		{ name: "snapshot_tracking", shape: "grid", count: 10 },
		{ name: "snapshot_step", shape: "table", count: 3 },
	]
}

function kernel({
	context,
	sigma,
	humidity,
}: GcmSnapshotKernelRequest): Promise<GcmKernel> {
	const { latitudes, longitudes } = context.state.dimensions
	let jet = 0
	for (let l = 1; l < sigma.length; l++)
		if (Math.abs(sigma[l] - JET_SIGMA) < Math.abs(sigma[jet] - JET_SIGMA))
			jet = l
	return KERNEL.pipeline({
		context,
		label: "snapshot pack",
		code: [GPU_MATH.PRECISE, PRECIPITATION.SATURATION_CODE, packCode].join(
			"\n",
		),
		constants: {
			THREADS: latitudes * longitudes,
			JET: jet,
			SIGMA: sigma[sigma.length - 1],
			RDBRV: humidity.rdbrv,
			RA1: humidity.ra1,
			RA2: humidity.ra2,
			RA4: humidity.ra4,
			TMELT: humidity.tmelt,
			MOIST: 1 / humidity.rdbrv - 1,
		},
	})
}

export const SNAPSHOT = {
	fields,
	kernel,
}
