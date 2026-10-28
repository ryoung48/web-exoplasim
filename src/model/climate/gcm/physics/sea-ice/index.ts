import { CALENDAR } from "@/model/climate/gcm/calendar"
import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import finishCode from "@/model/climate/gcm/physics/sea-ice/wgsl/finish.wgsl?raw"
import iceCode from "@/model/climate/gcm/physics/sea-ice/wgsl/ice.wgsl?raw"

// icemod's state and climatologies, the fields carried from the first ice
// kernel to the second across getiflx's global sum, and the sums.
function fields(): GcmFieldSpec[] {
	const points = ["xts", "xsst", "xmld", "xls", "xiced", "xicec", "xsnow"]
		.concat(["xqmelt", "xicecc", "xcflux", "xcfluxf", "xoheat", "xoflux"])
		.concat(["xgw", "xclsst2", "xclicec2", "xcliced2", "xclssto"])
		.concat(["xcfluxr", "ximelt", "xsmelt", "xsmflx", "xsndch"])
		.concat(["ice_zflx", "ice_snowold", "ice_part1", "ice_part2"])
	return [
		...points.map((name) => ({ name, shape: "grid" as const, count: 1 })),
		...["xclsst", "xclicec", "xcliced"].map((name) => ({
			name,
			shape: "grid" as const,
			count: CALENDAR.CLIMATOLOGY_MONTHS,
		})),
		{ name: "ice_sums", shape: "table", count: 2 },
	]
}

export const SEA_ICE = {
	fields,
	CODE: iceCode,
	FINISH_CODE: finishCode,
}
