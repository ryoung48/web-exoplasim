import type { ReactNode } from "react"

export interface EditableNumberValueProps {
	label: string
	value: ReactNode
	numericValue: number
	min: number
	max: number
	disabled: boolean
	valueClassName: string
	onChange: (value: number) => void
}

export interface LabeledNumberInputProps {
	label: string
	help: string
	unit: string
	value: number | null
	placeholder: string
	min: number
	disabled: boolean
	onChange: (value: number | null) => void
}
