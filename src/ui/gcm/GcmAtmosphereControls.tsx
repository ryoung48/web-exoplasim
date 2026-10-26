import { GCM_ATMOSPHERE } from "@/model/climate/gcm/atmosphere"
import type { GcmAtmosphereConfig } from "@/model/climate/gcm/atmosphere/types"
import { InputLabel } from "@/ui/components/primitives/InputLabel"
import { LabeledNumberInput } from "@/ui/components/primitives/LabeledNumberInput"
import { LabeledValueRow } from "@/ui/components/primitives/LabeledValueRow"
import { SegmentedControl } from "@/ui/components/primitives/SegmentedControl"
import { ToggleRow } from "@/ui/components/primitives/ToggleRow"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_INPUT_HELP } from "@/ui/gcm/input-help"
import type {
	GcmAtmosphereControlsProps,
	GcmAtmosphereModeOption,
	GcmGasChange,
} from "@/ui/gcm/types"
import { formatWithUnit } from "@/ui/genesis/shared/ui-format"

const MODE_OPTIONS: ReadonlyArray<GcmAtmosphereModeOption> = [
	{ value: "partialPressures", label: "Gas mixture" },
	{ value: "pressureAndGasConstant", label: "Pressure + gas constant" },
]

export function GcmAtmosphereControls({
	config,
	disabled,
	onChange,
}: GcmAtmosphereControlsProps) {
	const update = (patch: Partial<GcmAtmosphereConfig>) => {
		if (!disabled) onChange({ ...config, ...patch })
	}
	const updateGas = ({ gas, value }: GcmGasChange) =>
		update({ partialPressures: { ...config.partialPressures, [gas]: value } })
	const result = GCM_ATMOSPHERE.resolve(config)
	const note = `${uiTokens.type.controlTextSm} ${uiTokens.text.muted}`
	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<span className={uiTokens.field.label}>
					<InputLabel
						label="Atmosphere inputs"
						help={GCM_INPUT_HELP.atmosphereMode}
					/>
				</span>
				<SegmentedControl
					fullWidth
					options={MODE_OPTIONS}
					value={config.mode}
					onChange={(mode) => update({ mode })}
				/>
			</div>
			{config.mode === "pressureAndGasConstant" ? (
				<>
					<LabeledNumberInput
						label="Total surface pressure"
						help={GCM_INPUT_HELP.totalPressure}
						unit="bar"
						value={config.pressureBar}
						min={0}
						placeholder={formatWithUnit(
							GCM_ATMOSPHERE.NATIVE_PRESSURE_BAR,
							"",
							3,
						)}
						disabled={disabled}
						onChange={(pressureBar) => update({ pressureBar })}
					/>
					<LabeledNumberInput
						label="Effective gas constant"
						help={GCM_INPUT_HELP.gasConstant}
						unit="J/(kg·K)"
						value={config.gasConstant}
						min={0}
						placeholder={formatWithUnit(
							GCM_ATMOSPHERE.NATIVE_GAS_CONSTANT,
							"",
							3,
						)}
						disabled={disabled}
						onChange={(gasConstant) => update({ gasConstant })}
					/>
					<p className={note}>
						Blank uses ExoPlaSim’s native value. Gas partial pressures below are
						optional portions of this total; the gas constant describes the
						whole atmosphere.
					</p>
				</>
			) : (
				<p className={note}>
					Enter gas partial pressures to calculate total pressure and gas
					constant. Leaving all blank preserves ExoPlaSim’s native atmosphere.
				</p>
			)}
			{GCM_ATMOSPHERE.GASES.map((gas) => (
				<LabeledNumberInput
					key={gas.id}
					label={gas.label}
					help={GCM_INPUT_HELP[gas.id]}
					unit="bar"
					value={config.partialPressures[gas.id]}
					min={0}
					placeholder={gas.id === "CO2" ? "Native: 300 ppm" : "Not specified"}
					disabled={disabled}
					onChange={(value) => updateGas({ gas: gas.id, value })}
				/>
			))}
			{result.ok === true ? (
				<div className="space-y-1" aria-label="Resolved atmosphere">
					<LabeledValueRow
						label="Model surface pressure"
						value={formatWithUnit(result.values.pressureBar, "bar", 5)}
					/>
					<LabeledValueRow
						label="Model gas constant"
						value={formatWithUnit(result.values.gasConstant, "J/(kg·K)", 3)}
					/>
					<LabeledValueRow
						label="Model CO₂"
						value={formatWithUnit(result.values.co2Ppm, "ppm", 2)}
					/>
					{result.values.warnings.map((warning) => (
						<p key={warning} role="status" className={note}>
							{warning}
						</p>
					))}
				</div>
			) : (
				<p role="alert" className={note}>
					{result.message}
				</p>
			)}
			<ToggleRow
				label="Ozone"
				help={GCM_INPUT_HELP.ozone}
				checked={config.ozone}
				disabled={disabled}
				onChange={(ozone) => update({ ozone })}
			/>
			<p className={note}>
				Bulk gas settings do not add new absorption physics. The model assumes
				broadly Earthlike atmospheric behavior; hydrogen/helium-dominated moist
				climates need particular caution.
			</p>
		</div>
	)
}
