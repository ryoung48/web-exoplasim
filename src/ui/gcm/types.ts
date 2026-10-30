import type {
	GcmAtmosphereConfig,
	GcmAtmosphereMode,
	GcmGas,
} from "@/model/climate/gcm/atmosphere/types"
import { GcmAverageState } from "@/model/climate/gcm/averages/types"
import type { GcmCheckpointDiagnostics } from "@/model/climate/gcm/checkpoint/types"
import type { GcmClimateScheme } from "@/model/climate/gcm/classification/types"
import type { GcmMapMode } from "@/model/climate/gcm/fields/types"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type {
	GcmEngine,
	GcmResolution,
	GcmRunStatus,
} from "@/model/climate/gcm/runner/types"
import type { GcmTargetState } from "@/model/climate/gcm/targeting/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"
import type {
	GcmConfig,
	GcmOrbitOverrideKey,
	GcmPhysicsFilter,
	GcmSnapshot,
	GcmSurfaceOverrideKey,
} from "@/model/climate/gcm/types"
import type { RgbColor } from "@/model/shared/color/color-palettes/types"
import type { GcmHoverPoint } from "@/ui/gcm/hover/types"
import type { GcmMapViewport } from "@/ui/gcm/map-navigation/types"
import type { CoastlineLineData } from "@/ui/genesis/shared/coastline-lines"
import type { UnitSystem } from "@/ui/genesis/shared/ui-format"

export interface GcmModeValue {
	mode: GcmMapMode
	value: number
}

export interface GcmTerrainColorRequest {
	value: number
	min: number
	max: number
	land: number
}

export interface GcmFormattedValue extends GcmModeValue {
	unitSystem: UnitSystem
}

export type GcmColorScale = (value: number) => RgbColor

export type GcmPeriod = "now" | "month" | "year"

export type GcmViewMode = GcmMapMode | GcmClimateScheme | "elevation"

export interface GcmModeChild {
	value: GcmViewMode
	label: string
}

export interface GcmModeGroup {
	label: string
	defaultView: GcmViewMode
	children: ReadonlyArray<GcmModeChild>
}

export type GcmMapLayer =
	| { kind: "field"; snapshot: GcmSnapshot; mode: GcmMapMode }
	| {
			kind: "terrain"
			terrain: GcmTerrain
			maxElevationM: number
	  }
	| {
			kind: "classes"
			snapshot: GcmSnapshot
			classes: Uint8Array
			scheme: GcmClimateScheme
	  }
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
			scheme: GcmClimateScheme
			width: number
			height: number
			classes: Uint8Array
	  }

export type GcmMapDetail = "model" | "downscaled"

export interface GcmMapProps {
	loading: boolean
	readLayer: () => GcmMapLayer | null
	coastlines: CoastlineLineData | null
	emptyMessage: string
	onHover: (point: GcmHoverPoint | null) => void
}

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
	scheme: GcmClimateScheme
	snapshot: GcmSnapshot
	classes: Uint8Array
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

export interface GcmClimateEntry {
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
	| "initialGrowth"
	| "radiusEarth"
	| "gravityMs2"
	| "substellarLongitudeDeg"
	| "soilDepthScale"
	| "oceanDepthM"
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

export type GcmHelpKey =
	| GcmGas
	| "atmosphereMode"
	| "totalPressure"
	| "gasConstant"
	| GcmSurfaceOverrideKey
	| GcmOrbitOverrideKey
	| "keplerian"
	| "layers"
	| GcmSliderKey
	| "truncation"
	| "workers"
	| "timestepMinutes"
	| "physicsFilter"
	| "gridpointFilter"
	| "spectralFilter"
	| "synchronous"
	| "fixedOrbit"
	| "ozone"
	| "earthSurfaceClimatology"
	| "stormclim"
	| "wetSoil"
	| "glaciers"
	| "vegetation"
	| "heightmap"
	| "landMask"
	| "invertMask"
	| "blackElevation"
	| "whiteElevation"
	| "seaLevel"

export type GcmSmoothingFilter = Extract<
	GcmPhysicsFilter,
	"none" | "cesaro" | "exp" | "lh"
>

export interface GcmFilterToggle {
	filter: GcmPhysicsFilter
	enabled: boolean
}

export interface GcmOverrideSpec {
	key: GcmSurfaceOverrideKey | GcmOrbitOverrideKey
	label: string
	initialOverride: number
	min: number
	max: number
	step: number
	unit: string
	displayScale: number
	digits: number
}

export interface GcmOverrideControlsProps {
	section: "surface" | "orbit"
	unitSystem: UnitSystem
	config: GcmConfig
	disabled: boolean
	onChange: (config: GcmConfig) => void
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

export interface GcmBalanceViewRequest {
	averages: GcmAverageState
	targeting: GcmTargetState | null
}

export interface GcmLaunchRequest {
	previousConfig: GcmConfig | null
	terrain: GcmTerrain | null
	engine: GcmEngine
	config: GcmConfig
	restart: ArrayBuffer | null
	fresh: boolean
	paused: boolean
	diagnostics: GcmCheckpointDiagnostics | null
	averages: GcmAverageState | null
}

export interface GcmDownload {
	name: string
	bytes: ArrayBuffer
}

export interface GcmWorkerOption {
	value: string
	label: string
}

export interface GcmConfigPanelProps {
	locked: boolean
	engine: GcmEngine
	gpuAvailable: boolean | null
	onEngineChange: (engine: GcmEngine) => void
	config: GcmConfig
	terrain: GcmTerrain | null
	latitudes: number
	unitSystem: UnitSystem
	resolutions: ReadonlyArray<GcmResolution>
	workerChoice: string
	workerOptions: ReadonlyArray<GcmWorkerOption>
	onWorkerChange: (value: string) => void
	disabled: boolean
	onChange: (config: GcmConfig) => void
	onTerrainChange: (terrain: GcmTerrain | null) => void
}

export interface GcmAtmosphereControlsProps {
	locked: boolean
	config: GcmAtmosphereConfig
	disabled: boolean
	onChange: (config: GcmAtmosphereConfig) => void
}

export interface GcmGasChange {
	gas: GcmGas
	value: number | null
}

export interface GcmAtmosphereModeOption {
	value: GcmAtmosphereMode
	label: string
}

export interface GcmClimateLegendProps {
	readClasses: () => Uint8Array | null
	scheme: GcmClimateScheme
}
