import type { GcmMonthlyMean } from "@/model/climate/gcm/averages/types"
import type { GcmYearlyBalance } from "@/model/climate/gcm/balance/types"
import type { GcmCheckpointDiagnostics } from "@/model/climate/gcm/checkpoint/types"
import type { GcmMapMode } from "@/model/climate/gcm/fields/types"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmRunStatus } from "@/model/climate/gcm/runner/types"
import type {
	GcmConfig,
	GcmPhysicsFilter,
	GcmSnapshot,
} from "@/model/climate/gcm/types"
import type { RgbColor } from "@/model/shared/color/color-palettes/types"
import type { GcmMapViewport } from "@/ui/gcm/map-navigation/types"
import type { CoastlineLineData } from "@/ui/genesis/shared/coastline-lines"
import type { UnitSystem } from "@/ui/genesis/shared/ui-format"

export interface GcmModeValue {
	mode: GcmMapMode
	value: number
}

export interface GcmFormattedValue extends GcmModeValue {
	unitSystem: UnitSystem
}

export type GcmColorScale = (value: number) => RgbColor

export type GcmPeriod = "now" | "month" | "year"

export type GcmViewMode = GcmMapMode | "koppen"

export interface GcmModeChild {
	value: GcmMapMode
	label: string
}

export interface GcmModeGroup {
	label: string
	defaultView: GcmViewMode
	children: ReadonlyArray<GcmModeChild>
}

export type GcmMapLayer =
	| { kind: "field"; snapshot: GcmSnapshot; mode: GcmMapMode }
	| { kind: "classes"; snapshot: GcmSnapshot; classes: Uint8Array }
	| {
			kind: "downscaled-field"
			snapshot: GcmSnapshot
			mode: GcmMapMode
			width: number
			height: number
			values: Float32Array
	  }
	| {
			kind: "downscaled-classes"
			width: number
			height: number
			classes: Uint8Array
	  }

export type GcmMapDetail = "model" | "downscaled"

export interface GcmRasterPaint {
	width: number
	height: number
	color: (index: number) => RgbColor
}

export interface GcmMapPaint {
	canvas: HTMLCanvasElement
	layer: GcmMapLayer
	coastlines: CoastlineLineData | null
	viewport: GcmMapViewport
}

export interface GcmFieldPaint {
	canvas: HTMLCanvasElement
	snapshot: GcmSnapshot
	mode: GcmMapMode
	viewport: GcmMapViewport
}

export interface GcmClassPaint {
	snapshot: GcmSnapshot
	classes: Uint8Array
}

export interface GcmAverageState {
	months: GcmMonthlyMean[]
	years: GcmYearlyBalance[]
	annual: GcmSnapshot | null
	koppen: Uint8Array | null
}

export interface GcmLiveData {
	snapshot: GcmSnapshot | null
	averages: GcmAverageState
}

export interface GcmLiveStore {
	get(): GcmLiveData
	subscribe(listener: () => void): () => void
	update(patch: Partial<GcmLiveData>): void
}

export interface GcmPeriodRequest {
	period: GcmPeriod
	monthIndex: number | null
	snapshot: GcmSnapshot | null
	averages: GcmAverageState
}

export interface GcmPeriodView {
	snapshot: GcmSnapshot | null
	label: string
	emptyMessage: string
}

export interface GcmKoppenEntry {
	classId: number
	cells: number
}

export interface GcmColumnLookup {
	grid: GcmGrid
	column: number
}

export interface GcmLatitudeLookup {
	grid: GcmGrid
	latitude: number
}

export type GcmSliderKey = keyof Pick<
	GcmConfig,
	| "fluxWm2"
	| "starTemperatureK"
	| "obliquityDeg"
	| "eccentricity"
	| "rotationPeriodDays"
	| "yearDays"
	| "pN2Bar"
	| "pO2Bar"
	| "pArBar"
	| "initialGrowth"
>

export interface GcmSliderSpec {
	key: GcmSliderKey
	label: string
	min: number
	max: number
	step: number
	unit: string
	digits: number
}

export type GcmSmoothingFilter = Extract<
	GcmPhysicsFilter,
	"none" | "cesaro" | "exp" | "lh"
>

export interface GcmFilterToggle {
	filter: GcmPhysicsFilter
	enabled: boolean
}

export interface GcmStepSample {
	step: number
	time: number
}

export interface GcmRunState {
	status: GcmRunStatus | "idle"
	message: string
	device: string
	truncation: number
	stepsPerSecond: number
}

export interface GcmBalanceRow {
	label: string
	value: string
}

export interface GcmLaunchRequest {
	config: GcmConfig
	restart: ArrayBuffer | null
	fresh: boolean
	paused: boolean
	diagnostics: GcmCheckpointDiagnostics | null
}

export interface GcmDownload {
	name: string
	bytes: ArrayBuffer
}
