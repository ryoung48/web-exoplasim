import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

export interface GcmSnapshotKernelRequest {
	context: GcmKernelContext
	// initpm's full-level sigma, to find the jet level.
	sigma: ArrayLike<number>
}
