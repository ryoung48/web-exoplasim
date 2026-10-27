import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

export interface GcmSumRequest {
	context: GcmKernelContext
	label: string
	first: string
	second: string
	// A two-float table field receiving the sums of first and second.
	target: string
}
