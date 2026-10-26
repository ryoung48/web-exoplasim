import React, { useId } from "react"
import { cx } from "@/ui/components/lib"
import { InputLabel } from "@/ui/components/primitives/InputLabel"
import { uiTokens } from "@/ui/components/tokens"

interface ToggleRowProps {
	// [JUSTIFICATION] Existing toggles can omit contextual help.
	help?: string
	label: React.ReactNode
	checked: boolean
	onChange: (checked: boolean) => void
	disabled?: boolean
	className?: string
	labelClassName?: string
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
	label,
	help,
	checked,
	onChange,
	disabled,
	className,
	labelClassName,
}) => {
	const id = useId()
	const Container = help ? "div" : "label"
	return (
		<Container
			className={cx(
				"flex items-center justify-between gap-3 text-[11px] font-medium",
				uiTokens.text.primary,
				className,
			)}
		>
			<span className={labelClassName}>
				{help ? (
					<span className={uiTokens.field.labelWithHelp}>
						<label htmlFor={id}>{label}</label>
						<InputLabel
							label=""
							help={help}
							name={typeof label === "string" ? label : "this input"}
						/>
					</span>
				) : (
					<span>{label}</span>
				)}
			</span>
			<input
				id={id}
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange(e.target.checked)}
				className="h-4 w-4 rounded border-white/20 bg-slate-900 text-slate-100 focus:ring-slate-100/20"
			/>
		</Container>
	)
}
