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

export interface GcmHoverMonthLayer {
	month: number
	year: number
	layer: GcmMapLayer
}

export interface GcmHoverMonthlyRequest {
	point: GcmHoverPoint
	months: GcmHoverMonthLayer[]
	unitSystem: UnitSystem
}

export interface GcmHoverMonthlyValue {
	month: number
	year: number
	value: number
	formatted: string
	color: string
}

export interface GcmHoverReadoutProps {
	point: GcmHoverPoint | null
	readLayer: () => GcmMapLayer | null
	readMonths: () => GcmHoverMonthLayer[]
	unitSystem: UnitSystem
}
