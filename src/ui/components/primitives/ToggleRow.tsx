import React, { useId } from "react"
import { cx } from "@/ui/components/lib"
import { InputLabel } from "@/ui/components/primitives/InputLabel"
import { uiTokens } from "@/ui/components/tokens"

interface ToggleRowProps {
	// [JUSTIFICATION] Existing toggles can omit contextual help.
	help?: string
	label: string
	checked: boolean
	onChange: (checked: boolean) => void
	// [JUSTIFICATION] Most toggles are always editable.
	disabled?: boolean
	// [JUSTIFICATION] Only toggles sharing a row with another control need layout overrides.
	className?: string
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
	label,
	help,
	checked,
	onChange,
	disabled,
	className,
}) => {
	const id = useId()
	return (
		<div
			className={cx(
				"flex items-center justify-between gap-3",
				uiTokens.field.label,
				className,
			)}
		>
			<span className={uiTokens.field.labelWithHelp}>
				<label htmlFor={id} className="cursor-pointer">
					{label}
				</label>
				{help && <InputLabel label="" help={help} name={label} />}
			</span>
			<input
				id={id}
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
				className={uiTokens.field.check}
			/>
		</div>
	)
}
