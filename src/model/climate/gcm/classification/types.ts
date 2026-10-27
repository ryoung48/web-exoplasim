import type { GcmMonthlyMean } from "@/model/climate/gcm/averages/types"
import type { GcmDownscaleGrid } from "@/model/climate/gcm/downscale/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

export type GcmClimateScheme = "koppen" | "pasta"

export interface GcmClassificationRequest {
	config: GcmConfig
	months: ReadonlyArray<GcmMonthlyMean>
	downscale: GcmDownscaleGrid | null
	scheme: GcmClimateScheme
}
