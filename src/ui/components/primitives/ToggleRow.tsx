import React from "react"
import { cx } from "@/ui/components/lib"

interface ToggleRowProps {
	label: React.ReactNode
	checked: boolean
	onChange: (checked: boolean) => void
	disabled?: boolean
	className?: string
	labelClassName?: string
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
	label,
	checked,
	onChange,
	disabled,
	className,
	labelClassName,
}) => (
	<label
		className={cx(
			"flex items-center justify-between gap-3 text-[11px] font-medium text-slate-300",
			className,
		)}
	>
		<span className={labelClassName}>{label}</span>
		<input
			type="checkbox"
			checked={checked}
			disabled={disabled}
			onChange={(e) => onChange(e.target.checked)}
			className="h-4 w-4 rounded border-white/20 bg-slate-900 text-slate-100 focus:ring-slate-100/20"
		/>
	</label>
)
