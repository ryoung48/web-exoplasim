import { GCM_ATMOSPHERE } from "@/model/climate/gcm/atmosphere"
import type { GcmAtmosphereConfig } from "@/model/climate/gcm/atmosphere/types"
import { EditableNumberValue } from "@/ui/components/primitives/EditableNumberValue"
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
	advanced,
	disabled,
	onChange,
}: GcmAtmosphereControlsProps) {
	const update = (patch: Partial<GcmAtmosphereConfig>) => {
		if (!disabled) onChange({ ...config, ...patch })
	}
	const updateGas = ({ gas, value }: GcmGasChange) =>
		update({ partialPressures: { ...config.partialPressures, [gas]: value } })
	const result = GCM_ATMOSPHERE.resolve(config)
	const note = uiTokens.field.note
	const showMode = advanced || config.mode !== "partialPressures"
	return (
		<div className="space-y-3">
			{showMode && (
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
			)}
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
						Blank fields use ExoPlaSim’s Earth values. The gas pressures below
						are optional shares of this total, and the gas constant describes
						the whole atmosphere.
					</p>
				</>
			) : (
				<p className={note}>
					Enter the pressure of each gas and the total pressure and gas constant
					are calculated for you. Leave every gas blank to keep ExoPlaSim’s
					Earth atmosphere.
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
					placeholder={formatWithUnit(
						(result.ok
							? result.values.pressureBar
							: GCM_ATMOSPHERE.NATIVE_PRESSURE_BAR) * gas.nativeFraction,
						"",
						7,
					)}
					disabled={disabled}
					onChange={(value) => updateGas({ gas: gas.id, value })}
				/>
			))}
			<p className={note}>
				Greyed values show Earth-like dry air at the current pressure. A blank
				CO₂ field uses 300 ppm; other blank gases are left out of the mix. Enter
				gases in bar, not ppm: for 550 ppm CO₂ at 1 bar, enter 0.00055. In Gas
				mixture mode, also enter the background gases, because entering only CO₂
				gives a pure CO₂ atmosphere. To change CO₂ but keep Earth’s pressure and
				gas constant, open Advanced, choose Pressure + gas constant, leave those
				two blank, and enter only CO₂.
			</p>
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
						value={
							<EditableNumberValue
								label="Model CO₂"
								value={formatWithUnit(result.values.co2Ppm, "ppm", 2)}
								numericValue={result.values.co2Ppm}
								min={0}
								max={1e6}
								disabled={disabled}
								valueClassName=""
								onChange={(co2Ppm) => {
									if (!disabled)
										onChange(GCM_ATMOSPHERE.setCo2Ppm({ config, co2Ppm }))
								}}
							/>
						}
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
			{advanced && (
				<p className={note}>
					Gas settings only change the bulk mix; they add no new absorption
					physics. The model assumes Earth-like air, so be cautious with moist
					atmospheres dominated by hydrogen or helium.
				</p>
			)}
		</div>
	)
}
