import { CALENDAR } from "@/model/climate/gcm/calendar"
import type {
	GcmFieldSpec,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"
import type { GcmLandTablesRequest } from "@/model/climate/gcm/physics/land/types"
import routingCode from "@/model/climate/gcm/physics/land/wgsl/mkradv.wgsl?raw"
import soilCode from "@/model/climate/gcm/physics/land/wgsl/soil.wgsl?raw"
import surfaceCode from "@/model/climate/gcm/physics/land/wgsl/surface.wgsl?raw"

// landmod's soil layers (NLSOIL).
const SOIL_LAYERS = 5

// landmod's state: surface and soil temperatures, snow, the water bucket,
// river routing and the albedo climatology.
function fields(): GcmFieldSpec[] {
	const surface = ["land_dts", "land_dtsm", "land_dqs", "driver", "duroff"]
		.concat(["dvroff", "darea", "dsnowt", "dsnowz", "dwater", "dz0climo"])
		.concat(["dalbclim", "dalbclim1", "dalbclim2"])
	return [
		...surface.map((name) => ({ name, shape: "grid" as const, count: 1 })),
		{ name: "dsoilt", shape: "grid", count: SOIL_LAYERS },
		...["dalbcl", "dalbcl1", "dalbcl2"].map((name) => ({
			name,
			shape: "grid" as const,
			count: CALENDAR.CLIMATOLOGY_MONTHS,
		})),
	]
}

function tables({ dsoilz }: GcmLandTablesRequest): GcmTableValues {
	return { dsoilz: Float64Array.from(dsoilz) }
}

export const LAND = {
	fields,
	tables,
	SOIL_CODE: soilCode,
	ROUTING_CODE: routingCode,
	SURFACE_CODE: surfaceCode,
}
