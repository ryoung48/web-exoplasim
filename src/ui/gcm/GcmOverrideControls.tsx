import { LabeledSlider } from "@/ui/components/primitives/LabeledSlider"
import { ToggleRow } from "@/ui/components/primitives/ToggleRow"
import { GCM_INPUT_HELP } from "@/ui/gcm/input-help"
import type { GcmOverrideControlsProps, GcmOverrideSpec } from "@/ui/gcm/types"
import {
	formatPrecipitation,
	formatWithUnit,
} from "@/ui/genesis/shared/ui-format"

const SURFACE_OVERRIDES: ReadonlyArray<GcmOverrideSpec> = [
	...[
		{ key: "landAlbedo" as const, label: "Land albedo", initialOverride: 0.22 },
		{
			key: "oceanAlbedo" as const,
			label: "Ocean albedo",
			initialOverride: 0.069,
		},
		{
			key: "snowIceAlbedo" as const,
			label: "Snow/ice albedo",
			initialOverride: 0.7,
		},
	].map((spec) => ({
		...spec,
		min: 0,
		max: 1,
		step: 0.001,
		unit: "%",
		displayScale: 100,
		digits: 1,
	})),
	{
		key: "soilWaterCapacityM",
		label: "Soil water capacity",
		initialOverride: 0.5,
		min: 0.01,
		max: 2,
		step: 0.01,
		unit: "water",
		displayScale: 1000,
		digits: 0,
	},
	{
		key: "soilHeatCapacity",
		label: "Soil heat capacity",
		initialOverride: 2400000,
		min: 100000,
		max: 5000000,
		step: 100000,
		unit: "MJ/m³/K",
		displayScale: 0.000001,
		digits: 1,
	},
]

const ORBIT_OVERRIDES: ReadonlyArray<GcmOverrideSpec> = [
	{
		key: "periapseLongitudeDeg",
		label: "Longitude of periapse",
		initialOverride: 102.7,
		min: 0,
		max: 360,
		step: 0.1,
		unit: "°",
		displayScale: 1,
		digits: 1,
	},
	{
		key: "initialMeanAnomalyDeg",
		label: "Initial orbital phase",
		initialOverride: -2.9589,
		min: -360,
		max: 360,
		step: 0.0001,
		unit: "°",
		displayScale: 1,
		digits: 4,
	},
]

export function GcmOverrideControls({
	config,
	section,
	unitSystem,
	disabled,
	onChange,
}: GcmOverrideControlsProps) {
	return (section === "surface" ? SURFACE_OVERRIDES : ORBIT_OVERRIDES)
		.filter((spec) => spec.key !== "initialMeanAnomalyDeg" || config.keplerian)
		.map((spec) => {
			const { key, label, initialOverride } = spec
			const value = config[key]
			const update = (value: number | null) => {
				if (!disabled) onChange({ ...config, [key]: value })
			}
			return (
				<div key={key} className="space-y-1">
					<ToggleRow
						label={`${label} override`}
						help={GCM_INPUT_HELP[key]}
						checked={value !== null}
						disabled={disabled}
						onChange={(enabled) => update(enabled ? initialOverride : null)}
					/>
					{value !== null && (
						<LabeledSlider
							label={label}
							help={GCM_INPUT_HELP[key]}
							value={
								spec.unit === "water"
									? formatPrecipitation(
											value * spec.displayScale,
											unitSystem,
											spec.digits,
										)
									: formatWithUnit(
											value * spec.displayScale,
											spec.unit,
											spec.digits,
										)
							}
							numericValue={value}
							min={spec.min}
							max={spec.max}
							step={spec.step}
							disabled={disabled}
							onChange={update}
						/>
					)}
				</div>
			)
		})
}
