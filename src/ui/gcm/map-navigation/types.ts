import type { GcmHoverPoint } from "@/ui/gcm/hover/types"

export interface GcmMapNavigationRequest {
	canvas: HTMLCanvasElement
	onView: (viewport: GcmMapViewport) => void
	onHover: (point: GcmHoverPoint | null) => void
}

export interface GcmMapViewport {
	west: number
	north: number
	longitudeSpan: number
	latitudeSpan: number
}

export interface GcmMapNavigation {
	redraw(): void
	reset(): void
	zoomIn(): void
	zoomOut(): void
	dispose(): void
}
