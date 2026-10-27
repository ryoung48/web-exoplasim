import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import seastepCode from "@/model/climate/gcm/physics/sea/wgsl/seastep.wgsl?raw"

// seamod's own copies of the sea surface: temperature, humidity and SST.
function fields(): GcmFieldSpec[] {
	return ["sea_dts", "sea_dqs", "sea_dsst"].map((name) => ({
		name,
		shape: "grid",
		count: 1,
	}))
}

export const SEA = {
	fields,
	CODE: seastepCode,
}
