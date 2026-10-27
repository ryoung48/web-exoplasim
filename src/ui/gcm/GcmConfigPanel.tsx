import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import type { GcmEngine, GcmResolution } from "@/model/climate/gcm/runner/types"
import type {
	GcmConfig,
	GcmTruncation,
	GcmVegetation,
} from "@/model/climate/gcm/types"
import { LabeledSlider } from "@/ui/components/primitives/LabeledSlider"
import { SegmentedControl } from "@/ui/components/primitives/SegmentedControl"
import { ToggleRow } from "@/ui/components/primitives/ToggleRow"
import { uiTokens } from "@/ui/components/tokens"
import type {
	GcmFilterToggle,
	GcmSliderSpec,
	GcmSmoothingFilter,
} from "@/ui/gcm/types"
import { formatWithUnit } from "@/ui/genesis/shared/ui-format"

interface GcmConfigPanelProps {
	config: GcmConfig
	resolutions: ReadonlyArray<GcmResolution>
	engine: GcmEngine
	// null while the browser is being checked for WebGPU.
	gpuAvailable: boolean | null
	disabled: boolean
	onChange: (config: GcmConfig) => void
	onEngineChange: (engine: GcmEngine) => void
}

const BYTES_PER_MEGABYTE = 1_000_000
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
		max: 0.3,
		step: 0.005,
		unit: "",
		digits: 3,
	},
	{
		key: "rotationPeriodDays",
		label: "Rotation period",
		min: 0.25,
		max: 10,
		step: 0.25,
		unit: "days",
		digits: 2,
	},
	{
		key: "yearDays",
		label: "Year length",
		min: 60,
		max: 720,
		step: 12,
		unit: "days",
		digits: 0,
	},
]
const ATMOSPHERE_SLIDERS: ReadonlyArray<GcmSliderSpec> = [
	{
		key: "pN2Bar",
		label: "N₂",
		min: 0,
		max: 3,
		step: 0.01,
		unit: "bar",
		digits: 2,
	},
	{
		key: "pO2Bar",
		label: "O₂",
		min: 0,
		max: 1,
		step: 0.01,
		unit: "bar",
		digits: 2,
	},
	{
		key: "pArBar",
		label: "Ar",
		min: 0,
		max: 0.2,
		step: 0.005,
		unit: "bar",
		digits: 3,
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
const RADIATION_OPTIONS = [
	{ value: "1", label: "Every step" },
	{ value: "2", label: "Every 2" },
	{ value: "3", label: "Every 3" },
] as const
const TIMESTEP_OPTIONS = [
	{ value: "30", label: "30 min" },
	{ value: "45", label: "45 min" },
] as const

function isSmoothing(filter: string): filter is GcmSmoothingFilter {
	return (SMOOTHING_FILTERS as ReadonlyArray<string>).includes(filter)
}

export function GcmConfigPanel({
	config,
	resolutions,
	engine,
	gpuAvailable,
	disabled,
	onChange,
	onEngineChange,
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
	const groupClass = `min-w-0 space-y-3 border-t pt-3 ${uiTokens.border.default}`
	const groupLabel = `pr-2 ${uiTokens.type.controlWide} ${uiTokens.text.primary}`

	return (
		<div className="space-y-3">
			<p className={`${uiTokens.type.label} ${uiTokens.text.subtle}`}>
				Applied when the run starts
			</p>
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
						<span className={label}>Resolution</span>
						<SegmentedControl
							fullWidth
							options={resolutions.map((resolution) => {
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
				<div className="space-y-1">
					<span className={label}>Timestep</span>
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
					<span className={label}>Radiation</span>
					<SegmentedControl
						fullWidth
						options={RADIATION_OPTIONS}
						value={
							String(
								config.radiationIntervalSteps,
							) as (typeof RADIATION_OPTIONS)[number]["value"]
						}
						onChange={(value) =>
							update({ radiationIntervalSteps: Number(value) })
						}
					/>
				</div>
				<div className="space-y-1">
					<span className={label}>Spectral filter</span>
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
					checked={config.physicsFilter.includes("gp")}
					disabled={disabled}
					onChange={(enabled) => toggleFilter({ filter: "gp", enabled })}
				/>
				<ToggleRow
					label="Filter spectral tendencies"
					checked={config.physicsFilter.includes("sp")}
					disabled={disabled}
					onChange={(enabled) => toggleFilter({ filter: "sp", enabled })}
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
					label="Fixed orbit"
					checked={config.fixedOrbit}
					disabled={disabled}
					onChange={(fixedOrbit) => update({ fixedOrbit })}
				/>
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Atmosphere</legend>
				{ATMOSPHERE_SLIDERS.map(renderSlider)}
				<ToggleRow
					label="Ozone"
					checked={config.ozone}
					disabled={disabled}
					onChange={(ozone) => update({ ozone })}
				/>
			</fieldset>
			<fieldset disabled={disabled} className={groupClass}>
				<legend className={groupLabel}>Surface & vegetation</legend>
				<ToggleRow
					label="Earth surface climatology"
					checked={config.earthSurfaceClimatology}
					disabled={disabled}
					onChange={(earthSurfaceClimatology) =>
						update({ earthSurfaceClimatology })
					}
				/>
				<ToggleRow
					label="Wet soil"
					checked={config.wetSoil}
					disabled={disabled}
					onChange={(wetSoil) => update({ wetSoil })}
				/>
				{GCM_NAMELIST.wetSoilOverridden(config) && (
					<p
						className={`${uiTokens.type.controlTextSm} ${uiTokens.text.muted}`}
					>
						ExoPlaSim turns wet soil off when a star temperature is set
						(two-band albedo).
					</p>
				)}
				<ToggleRow
					label="Glaciers"
					checked={config.glaciers.enabled}
					disabled={disabled}
					onChange={(enabled) =>
						update({ glaciers: { ...config.glaciers, enabled } })
					}
				/>
				<div className="space-y-1">
					<span className={label}>Vegetation</span>
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
