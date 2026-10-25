import React from "react"
import { cx } from "@/ui/components/lib"
import { LabeledValueRow } from "@/ui/components/primitives/LabeledValueRow"

interface LabeledSliderProps {
	label: React.ReactNode
	value: React.ReactNode
	min: number
	max: number
	step?: number
	numericValue: number
	onChange: (value: number) => void
	disabled?: boolean
	className?: string
	sliderClassName?: string
	onPointerUp?: React.PointerEventHandler<HTMLInputElement>
	onKeyUp?: React.KeyboardEventHandler<HTMLInputElement>
	onBlur?: React.FocusEventHandler<HTMLInputElement>
}

export const LabeledSlider: React.FC<LabeledSliderProps> = ({
	label,
	value,
	min,
	max,
	step,
	numericValue,
	onChange,
	disabled,
	className,
	sliderClassName,
	onPointerUp,
	onKeyUp,
	onBlur,
}) => (
	<div className={className}>
		<LabeledValueRow
			label={label}
			value={value}
			labelClassName="text-[11px] font-medium text-slate-300"
			valueClassName="font-mono text-[11px] text-slate-400"
		/>
		<input
			type="range"
			min={min}
			max={max}
			step={step}
			value={numericValue}
			disabled={disabled}
			onChange={(e) => onChange(Number(e.target.value))}
			onPointerUp={onPointerUp}
			onKeyUp={onKeyUp}
			onBlur={onBlur}
			className={cx(
				"w-full accent-slate-100 disabled:cursor-not-allowed",
				sliderClassName,
			)}
		/>
	</div>
)
