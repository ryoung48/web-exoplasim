import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import seastepCode from "@/model/climate/gcm/physics/sea/wgsl/seastep.wgsl?raw"

// seamod's own copies of the sea surface (temperature, humidity and SST),
// and its sums of heat flux and snowfall since icestep last ran, with
// their count (naccua, kept per point).
function fields(): GcmFieldSpec[] {
	const names = ["sea_dts", "sea_dqs", "sea_dsst"]
	return names
		.concat(["sea_cheata", "sea_cprsa", "sea_naccua"])
		.map((name) => ({
			name,
			shape: "grid",
			count: 1,
		}))
}

export const SEA = {
	fields,
	CODE: seastepCode,
}
