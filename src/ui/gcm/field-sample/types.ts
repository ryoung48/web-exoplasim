import type { GcmHoverPoint } from "@/ui/gcm/hover/types"
import type { GcmMapLayer } from "@/ui/gcm/types"

export interface GcmFieldSampleRequest {
	layer: GcmMapLayer
	point: GcmHoverPoint
}
