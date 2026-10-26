import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

export interface GcmFixerRequest {
	context: GcmKernelContext
	delt2: number
	psurf: number
}

export interface GcmFixerTablesRequest {
	grid: GcmGrid
}
