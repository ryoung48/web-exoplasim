import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

// Pipeline constants under the WGSL override names (carbonmod's names
// upper-cased; PLARAD is pumamod's planet radius).
export interface GcmCarbonConstants {
	NCARBON: number
	NSUPPLY: number
	TIMEWEIGHT: number
	CO2EARTH: number
	BETA: number
	KACT: number
	PEARTH: number
	WMAX: number
	VEARTH: number
	PLARAD: number
	RAD_EARTHSQ: number
}

export interface GcmCarbonRequest {
	context: GcmKernelContext
	constants: GcmCarbonConstants
}

// carbonmod's step counter, kept on the CPU: weathering runs when the
// counter reaches `interval` and then restarts from 0.
export interface GcmCarbonCycle {
	cstep: number
	interval: number
}

export interface GcmCarbonCycleStep {
	cstep: number
	weathers: boolean
}
