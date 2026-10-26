import { InputLabel } from "@/ui/components/primitives/InputLabel"
import type { LabeledNumberInputProps } from "@/ui/components/primitives/number-input/types"
import { uiTokens } from "@/ui/components/tokens"

export function LabeledNumberInput({
	label,
	help,
	unit,
	value,
	placeholder,
	min,
	disabled,
	onChange,
}: LabeledNumberInputProps) {
	return (
		<div className="space-y-1">
			<div className={uiTokens.field.numberLabel}>
				<InputLabel label={label} help={help} />
				<span>{unit}</span>
			</div>
			<input
				type="number"
				aria-label={label}
				step="any"
				min={min}
				value={value ?? ""}
				placeholder={placeholder}
				disabled={disabled}
				className={uiTokens.field.numberInput}
				onChange={(event) =>
					onChange(
						event.target.value === "" ? null : event.target.valueAsNumber,
					)
				}
			/>
		</div>
	)
}
