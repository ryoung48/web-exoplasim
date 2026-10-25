import type { GcmMapLayer } from "@/ui/gcm/types"
import type { UnitSystem } from "@/ui/genesis/shared/ui-format"

export interface GcmHoverPoint {
	latitude: number
	longitude: number
}

export interface GcmHoverRequest {
	point: GcmHoverPoint
	layer: GcmMapLayer
	unitSystem: UnitSystem
}

export interface GcmHoverRow {
	label: string
	value: string
}

export interface GcmHoverReadoutProps {
	point: GcmHoverPoint | null
	readLayer: () => GcmMapLayer | null
	unitSystem: UnitSystem
}
