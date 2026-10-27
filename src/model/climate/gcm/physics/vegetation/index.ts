import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import vegstepCode from "@/model/climate/gcm/physics/vegetation/wgsl/vegstep.wgsl?raw"

// simba's carbon pools and cover and its per-point growth parameters.
// vegstep also reads pumamod's CO2, which CARBON owns.
function fields(): GcmFieldSpec[] {
	return [
		"dcveg",
		"dcsoil",
		"dlai",
		"dvsoil",
		"dagg",
		"dgrow",
		"dsc",
		"dmr",
	].map((name) => ({ name, shape: "grid" as const, count: 1 }))
}

export const VEGETATION = {
	fields,
	CODE: vegstepCode,
}
