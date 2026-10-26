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
