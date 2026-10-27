import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import type { GcmSnapshotKernelRequest } from "@/model/climate/gcm/snapshot/types"
import packCode from "@/model/climate/gcm/snapshot/wgsl/pack.wgsl?raw"

// gcm_publish.f90's field count: the snapshot the page receives.
const FIELDS = 18
// gcm_publish.f90's jet level: the full level nearest sigma 0.25.
const JET_SIGMA = 0.25

function fields(): GcmFieldSpec[] {
	return [{ name: "snapshot", shape: "grid", count: FIELDS }]
}

function kernel({
	context,
	sigma,
}: GcmSnapshotKernelRequest): Promise<GcmKernel> {
	const { latitudes, longitudes } = context.state.dimensions
	let jet = 0
	for (let l = 1; l < sigma.length; l++)
		if (Math.abs(sigma[l] - JET_SIGMA) < Math.abs(sigma[jet] - JET_SIGMA))
			jet = l
	return KERNEL.pipeline({
		context,
		label: "snapshot pack",
		code: packCode,
		constants: { THREADS: latitudes * longitudes, JET: jet },
	})
}

export const SNAPSHOT = {
	FIELDS,
	fields,
	kernel,
}
