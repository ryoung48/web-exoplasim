import { CALENDAR } from "@/model/climate/gcm/calendar"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import oceanstepCode from "@/model/climate/gcm/physics/ocean/wgsl/oceanstep.wgsl?raw"

// oceanmod's slab: SST, mixed-layer depth, land mask, flux correction and
// the SST climatology.
function fields(): GcmFieldSpec[] {
	return [
		...["ysst", "ymld", "yls", "yfldo", "yclsst2"].map((name) => ({
			name,
			shape: "grid" as const,
			count: 1,
		})),
		{ name: "yclsst", shape: "grid", count: CALENDAR.CLIMATOLOGY_MONTHS },
	]
}

export const OCEAN = {
	fields,
	CODE: oceanstepCode,
}
