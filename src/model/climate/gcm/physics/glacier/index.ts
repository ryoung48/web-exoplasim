import type { GcmFieldSpec } from "@/model/climate/gcm/layout/types"
import glacierstepCode from "@/model/climate/gcm/physics/glacier/wgsl/glacierstep.wgsl?raw"

// glaciermod's persistflag (1 while land has kept glacelim of snow since the
// year began); dglac is pumamod's.
function fields(): GcmFieldSpec[] {
	return [{ name: "dpersist", shape: "grid", count: 1 }]
}

export const GLACIER = {
	fields,
	CODE: glacierstepCode,
}
