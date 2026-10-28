import type {
	GcmConfig,
	GcmLayerCount,
	GcmTruncation,
	GcmVegetation,
} from "@/model/climate/gcm/types"
import { InputLabel } from "@/ui/components/primitives/InputLabel"
import { LabeledSlider } from "@/ui/components/primitives/LabeledSlider"
import { SegmentedControl } from "@/ui/components/primitives/SegmentedControl"
import { ToggleRow } from "@/ui/components/primitives/ToggleRow"
import { uiTokens } from "@/ui/components/tokens"
import { GcmAtmosphereControls } from "@/ui/gcm/GcmAtmosphereControls"
import { GcmOverrideControls } from "@/ui/gcm/GcmOverrideControls"
import { GCM_INPUT_HELP } from "@/ui/gcm/input-help"
import { TerrainPanel } from "@/ui/gcm/terrain/TerrainPanel"
import type {
	GcmConfigPanelProps,
	GcmFilterToggle,
	GcmSliderSpec,
	GcmSmoothingFilter,
} from "@/ui/gcm/types"
import { formatWithUnit } from "@/ui/genesis/shared/ui-format"

const BYTES_PER_MEGABYTE = 1_000_000
const PLANET_SLIDERS: ReadonlyArray<GcmSliderSpec> = [
	{
		key: "radiusEarth",
		label: "Planet radius",
		min: 0.5,
		max: 2,
		step: 0.01,
		unit: "R⊕",
		digits: 2,
	},
	{
		key: "gravityMs2",
		label: "Surface gravity",
		min: 1,
		max: 30,
		step: 0.01,
		unit: "m/s²",
		digits: 2,
	},
]
const SUBSTELLAR_SLIDER: GcmSliderSpec = {
	key: "substellarLongitudeDeg",
	label: "Substellar longitude",
	min: 0,
	max: 360,
	step: 1,
	unit: "°E",
	digits: 0,
}
const SOIL_DEPTH_SLIDER: GcmSliderSpec = {
	key: "soilDepthScale",
	label: "Soil depth multiplier",
	min: 0.1,
	max: 5,
	step: 0.1,
	unit: "×",
	digits: 1,
}
const OCEAN_DEPTH_SLIDER: GcmSliderSpec = {
	key: "oceanDepthM",
	label: "Ocean mixed-layer depth",
	min: 1,
	max: 200,
	step: 1,
	unit: "m",
	digits: 0,
}
const STAR_SLIDERS: ReadonlyArray<GcmSliderSpec> = [
	{
		key: "fluxWm2",
		label: "Stellar flux",
		min: 800,
		max: 2000,
		step: 1,
		unit: "W/m²",
		digits: 0,
	},
	{
		key: "starTemperatureK",
		label: "Star temperature",
		min: 2600,
		max: 10000,
		step: 10,
		unit: "K",
		digits: 0,
	},
]
const ORBIT_SLIDERS: ReadonlyArray<GcmSliderSpec> = [
	{
		key: "obliquityDeg",
		label: "Obliquity",
		min: 0,
		max: 90,
		step: 0.5,
		unit: "°",
		digits: 1,
	},
	{
		key: "eccentricity",
		label: "Eccentricity",
		min: 0,
		max: 0.8,
		step: 0.005,
		unit: "",
		digits: 3,
	},
	{
		key: "rotationPeriodDays",
		label: "Rotation period",
		min: 0.25,
		max: 100,
		step: 0.25,
		unit: "days",
		digits: 2,
	},
	{
		key: "yearDays",
		label: "Year length",
		min: 60,
		max: 720,
		step: 1,
		unit: "days",
		digits: 0,
	},
]
const GROWTH_SLIDER: GcmSliderSpec = {
	key: "initialGrowth",
	label: "Initial growth",
	min: 0,
	max: 1,
	step: 0.05,
	unit: "",
	digits: 2,
}
const SMOOTHING_FILTERS: ReadonlyArray<GcmSmoothingFilter> = [
	"none",
	"cesaro",
	"exp",
	"lh",
]
const VEGETATION_OPTIONS = [
	{ value: "0", label: "Off" },
	{ value: "1", label: "Diagnostic" },
	{ value: "2", label: "Coupled" },
] as const
const SMOOTHING_OPTIONS = [
	{ value: "none", label: "None" },
	{ value: "cesaro", label: "Cesàro" },
	{ value: "exp", label: "Exp" },
	{ value: "lh", label: "L-H" },
] as const
const TIMESTEP_OPTIONS = [
	{ value: "5", label: "5" },
	{ value: "10", label: "10" },
	{ value: "15", label: "15" },
	{ value: "20", label: "20" },
	{ value: "30", label: "30" },
	{ value: "45", label: "45" },
] as const

function isSmoothing(filter: string): filter is GcmSmoothingFilter {
	return (SMOOTHING_FILTERS as ReadonlyArray<string>).includes(filter)
}

export function GcmConfigPanel({
	config,
	terrain,
	latitudes,
	unitSystem,
	resolutions,
	engine,
	gpuAvailable,
	onEngineChange,
	workerChoice,
	workerOptions,
	onWorkerChange,
	disabled,
	onChange,
	onTerrainChange,
}: GcmConfigPanelProps) {
	const update = (patch: Partial<GcmConfig>) => {
		if (!disabled) onChange({ ...config, ...patch })
	}
	const smoothing = config.physicsFilter.find(isSmoothing) ?? "none"
	const toggleFilter = ({ filter, enabled }: GcmFilterToggle) =>
		update({
			physicsFilter: [
				...config.physicsFilter.filter((each) => each !== filter),
				...(enabled ? [filter] : []),
			],
		})
	const renderSlider = (spec: GcmSliderSpec) => (
		<LabeledSlider
			key={spec.key}
			label={spec.label}
			help={GCM_INPUT_HELP[spec.key]}
			value={formatWithUnit(config[spec.key], spec.unit, spec.digits)}
			numericValue={config[spec.key]}
			min={spec.min}
			max={spec.max}
			step={spec.step}
			disabled={disabled}
			onChange={(value) => update({ [spec.key]: value })}
		/>
	)
	const label = `${uiTokens.type.label} ${uiTokens.text.muted}`
	const groupClass = `min-w-0 space-y-3 border-t pt-1.5 [&>legend]:mb-0 ${uiTokens.border.default}`
	const groupLabel = `pr-2 ${uiTokens.type.controlWide} ${uiTokens.text.primary}`

	return (
		<div className="space-y-3">
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Numerics</legend>
				<div className="space-y-1">
					<span className={label}>Engine</span>
					<SegmentedControl
						fullWidth
						options={[
							{
								value: "gpu",
								label: "GPU",
								disabled: gpuAvailable === false,
								title:
									gpuAvailable === false
										? "This browser has no WebGPU"
										: "The WebGPU port of ExoPlaSim, on the graphics card",
							},
							{
								value: "cpu",
								label: "CPU",
								title: "ExoPlaSim compiled to WebAssembly, on CPU workers",
							},
						]}
						value={engine}
						onChange={(value) => {
							if (!disabled) onEngineChange(value)
						}}
					/>
				</div>
				{resolutions.length > 0 && (
					<div className="space-y-1">
						<span className={label}>
							<InputLabel label="Resolution" help={GCM_INPUT_HELP.truncation} />
						</span>
						<SegmentedControl
							fullWidth
							options={resolutions
								.filter(
									(resolution) =>
										resolution.layers === config.layers &&
										(engine !== "cpu" || resolution.truncation !== 63),
								)
								.map((resolution) => {
									const assets = resolution[engine]
									return {
										value: String(resolution.truncation),
										label: assets
											? `T${resolution.truncation} · ${formatWithUnit(assets.downloadBytes / BYTES_PER_MEGABYTE, "MB", 1)}`
											: `T${resolution.truncation}`,
										disabled: !assets,
										title: assets
											? undefined
											: `Not built for the ${engine.toUpperCase()} engine`,
									}
								})}
							value={String(config.truncation)}
							onChange={(value) =>
								update({ truncation: Number(value) as GcmTruncation })
							}
						/>
					</div>
				)}
				<fieldset className="space-y-1" aria-label="Atmospheric layers">
					<legend className={label}>
						<InputLabel
							label="Atmospheric layers"
							help={GCM_INPUT_HELP.layers}
						/>
					</legend>
					<SegmentedControl
						fullWidth
						options={[
							{ value: "5", label: "5 layers" },
							{ value: "10", label: "10 layers" },
						]}
						value={String(config.layers)}
						onChange={(value) =>
							update({ layers: Number(value) as GcmLayerCount })
						}
					/>
				</fieldset>
				{engine === "cpu" && (
					<fieldset className="space-y-1" aria-label="Workers">
						<legend className={label}>
							<InputLabel label="Workers" help={GCM_INPUT_HELP.workers} />
						</legend>
						<SegmentedControl
							fullWidth
							options={workerOptions}
							value={workerChoice}
							onChange={onWorkerChange}
						/>
					</fieldset>
				)}
				<div className="space-y-1">
					<span className={label}>
						<InputLabel
							label="Timestep (minutes)"
							help={GCM_INPUT_HELP.timestepMinutes}
						/>
					</span>
					<SegmentedControl
						fullWidth
						options={TIMESTEP_OPTIONS}
						value={
							String(
								config.timestepMinutes,
							) as (typeof TIMESTEP_OPTIONS)[number]["value"]
						}
						onChange={(value) => update({ timestepMinutes: Number(value) })}
					/>
				</div>
				<div className="space-y-1">
					<span className={label}>
						<InputLabel
							label="Spectral filter"
							help={GCM_INPUT_HELP.physicsFilter}
						/>
					</span>
					<SegmentedControl
						fullWidth
						options={SMOOTHING_OPTIONS}
						value={smoothing}
						onChange={(value) =>
							update({
								physicsFilter: [
									...config.physicsFilter.filter(
										(filter) => !isSmoothing(filter),
									),
									value,
								],
							})
						}
					/>
				</div>
				<ToggleRow
					label="Filter gridpoint tendencies"
					help={GCM_INPUT_HELP.gridpointFilter}
					checked={config.physicsFilter.includes("gp")}
					disabled={disabled}
					onChange={(enabled) => toggleFilter({ filter: "gp", enabled })}
				/>
				<ToggleRow
					label="Filter spectral tendencies"
					help={GCM_INPUT_HELP.spectralFilter}
					checked={config.physicsFilter.includes("sp")}
					disabled={disabled}
					onChange={(enabled) => toggleFilter({ filter: "sp", enabled })}
				/>
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Planet</legend>
				{PLANET_SLIDERS.map(renderSlider)}
				<TerrainPanel
					terrain={terrain}
					latitudes={latitudes}
					disabled={disabled}
					unitSystem={unitSystem}
					onChange={onTerrainChange}
				/>
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Star</legend>
				{STAR_SLIDERS.map(renderSlider)}
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Orbit & rotation</legend>
				{ORBIT_SLIDERS.map(renderSlider)}
				<ToggleRow
					label="Generic Keplerian orbit"
					help={GCM_INPUT_HELP.keplerian}
					checked={config.keplerian}
					disabled={disabled}
					onChange={(keplerian) => update({ keplerian })}
				/>
				<GcmOverrideControls
					section="orbit"
					config={config}
					unitSystem={unitSystem}
					disabled={disabled}
					onChange={onChange}
				/>
				<ToggleRow
					label="Tidally locked illumination"
					help={GCM_INPUT_HELP.synchronous}
					checked={config.synchronous}
					disabled={disabled}
					onChange={(synchronous) => update({ synchronous })}
				/>
				{config.synchronous && renderSlider(SUBSTELLAR_SLIDER)}
				<ToggleRow
					label="Fixed orbit"
					help={GCM_INPUT_HELP.fixedOrbit}
					checked={config.fixedOrbit}
					disabled={disabled}
					onChange={(fixedOrbit) => update({ fixedOrbit })}
				/>
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Atmosphere</legend>
				<GcmAtmosphereControls
					config={config.atmosphere}
					disabled={disabled}
					onChange={(atmosphere) => update({ atmosphere })}
				/>
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Surface & vegetation</legend>
				{renderSlider(OCEAN_DEPTH_SLIDER)}
				{renderSlider(SOIL_DEPTH_SLIDER)}
				<GcmOverrideControls
					section="surface"
					unitSystem={unitSystem}
					config={config}
					disabled={disabled}
					onChange={onChange}
				/>
				{terrain === null && (
					<ToggleRow
						label="Earth surface climatology"
						help={GCM_INPUT_HELP.earthSurfaceClimatology}
						checked={config.earthSurfaceClimatology}
						disabled={disabled}
						onChange={(earthSurfaceClimatology) =>
							update({ earthSurfaceClimatology })
						}
					/>
				)}
				<ToggleRow
					label="Wet soil"
					help={GCM_INPUT_HELP.wetSoil}
					checked={config.wetSoil}
					disabled={disabled}
					onChange={(wetSoil) => update({ wetSoil })}
				/>
				<ToggleRow
					label="Glaciers"
					help={GCM_INPUT_HELP.glaciers}
					checked={config.glaciers.enabled}
					disabled={disabled}
					onChange={(enabled) =>
						update({ glaciers: { ...config.glaciers, enabled } })
					}
				/>
				<div className="space-y-1">
					<span className={label}>
						<InputLabel label="Vegetation" help={GCM_INPUT_HELP.vegetation} />
					</span>
					<SegmentedControl
						fullWidth
						options={VEGETATION_OPTIONS}
						value={
							String(
								config.vegetation,
							) as (typeof VEGETATION_OPTIONS)[number]["value"]
						}
						onChange={(value) =>
							update({ vegetation: Number(value) as GcmVegetation })
						}
					/>
				</div>
				{config.vegetation > 0 && renderSlider(GROWTH_SLIDER)}
			</fieldset>
		</div>
	)
}
