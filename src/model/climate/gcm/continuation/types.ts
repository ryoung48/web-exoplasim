import type { GcmConfig } from "@/model/climate/gcm/types"

export interface GcmConfigChange {
	config: GcmConfig
	previousConfig: GcmConfig
}

export interface GcmContinuationFields {
	config: GcmConfig
	previousConfig: GcmConfig | null
	initial: Record<string, Float64Array>
}
