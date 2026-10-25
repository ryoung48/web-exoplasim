import type { GcmBoundary } from "@/model/climate/gcm/boundary/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"
import type { UnitSystem } from "@/ui/genesis/shared/ui-format"

export interface GcmTerrainPanelProps {
	terrain: GcmTerrain | null
	latitudes: number
	disabled: boolean
	unitSystem: UnitSystem
	onChange: (terrain: GcmTerrain | null) => void
}

export interface GcmTerrainUpload {
	file: File
	kind: "heightmap" | "mask"
}

export interface GcmTerrainPreviewProps {
	terrain: GcmTerrain
	boundary: GcmBoundary | null
	label: string
}

export interface GcmTerrainPaint extends GcmTerrainPreviewProps {
	canvas: HTMLCanvasElement
}
