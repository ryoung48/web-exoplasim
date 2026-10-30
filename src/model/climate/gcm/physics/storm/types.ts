import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

export interface GcmStormConstants {
	NSTORMDIAG: number
	RD: number
	OMEGA: number
	CKCD: number
	VITHRESH: number
}

export interface GcmStormRequest {
	context: GcmKernelContext
	constants: GcmStormConstants
}
