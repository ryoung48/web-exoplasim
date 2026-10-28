import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"
import type { GcmPrecipitationConstants } from "@/model/climate/gcm/physics/precipitation/types"

export interface GcmSnapshotKernelRequest {
	humidity: GcmPrecipitationConstants
	context: GcmKernelContext
	// initpm's full-level sigma, to find the jet level.
	sigma: ArrayLike<number>
}
