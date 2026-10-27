import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import vegstepCode from "@/model/climate/gcm/physics/vegetation/wgsl/vegstep.wgsl?raw"

// simba's carbon pools and cover, its per-point growth parameters, and
// pumamod's CO2 (ppmv), which carbonmod updates.
function fields(): GcmFieldSpec[] {
	return [
		...["dcveg", "dcsoil", "dlai", "dvsoil", "dagg", "dgrow", "dsc", "dmr"].map(
			(name) => ({ name, shape: "grid" as const, count: 1 }),
		),
		{ name: "co2", shape: "table", count: 1 },
	]
}

export const VEGETATION = {
	fields,
	CODE: vegstepCode,
}
