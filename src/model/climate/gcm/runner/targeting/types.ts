import type { GcmAverager } from "@/model/climate/gcm/averages/types"

export interface GcmTargetResume {
	restart: ArrayBuffer | null
	averager: GcmAverager | null
}
