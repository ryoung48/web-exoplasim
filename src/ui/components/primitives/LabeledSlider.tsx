import React from "react"
import { EditableNumberValue } from "@/ui/components/primitives/EditableNumberValue"
import { InputLabel } from "@/ui/components/primitives/InputLabel"
import { uiTokens } from "@/ui/components/tokens"

interface LabeledSliderProps {
	// [JUSTIFICATION] Sliders outside model settings can omit contextual help.
	help?: string
	label: string
	value: React.ReactNode
	min: number
	max: number
	// [JUSTIFICATION] Native range inputs default to a step of 1.
	step?: number
	numericValue: number
	onChange: (value: number) => void
	// [JUSTIFICATION] Most sliders are always editable.
	disabled?: boolean
}

export const LabeledSlider: React.FC<LabeledSliderProps> = ({
	label,
	help,
	value,
	min,
	max,
	step,
	numericValue,
	onChange,
	disabled,
}) => {
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2">
				<span className={uiTokens.field.label}>
					{help ? <InputLabel label={label} help={help} /> : label}
				</span>
				<EditableNumberValue
					label={label}
					value={value}
					numericValue={numericValue}
					min={min}
					max={max}
					disabled={disabled ?? false}
					valueClassName={uiTokens.field.value}
					onChange={onChange}
				/>
			</div>
			<input
				type="range"
				aria-label={label}
				min={min}
				max={max}
				step={step}
				value={numericValue}
				disabled={disabled}
				onChange={(event) => onChange(Number(event.target.value))}
				className={uiTokens.field.range}
			/>
		</div>
	)
}
