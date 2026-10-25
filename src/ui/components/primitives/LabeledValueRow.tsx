import React from "react"
import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"

type RowTone = "panel" | "overlay"

const labelToneClassName: Record<RowTone, string> = {
	panel: `${uiTokens.type.label} ${uiTokens.text.muted}`,
	overlay: `${uiTokens.type.labelWide} ${uiTokens.text.inverseMuted}`,
}

const valueToneClassName: Record<RowTone, string> = {
	panel: `${uiTokens.type.value} ${uiTokens.text.primary}`,
	overlay: `${uiTokens.type.valueSm} text-slate-100`,
}

interface LabeledValueRowProps {
	label: React.ReactNode
	value: React.ReactNode
	tone?: RowTone
	className?: string
	labelClassName?: string
	valueClassName?: string
	align?: "baseline" | "start"
}

export const LabeledValueRow: React.FC<LabeledValueRowProps> = ({
	label,
	value,
	tone = "panel",
	className,
	labelClassName,
	valueClassName,
	align = "baseline",
}) => (
	<div
		className={cx(
			"flex justify-between gap-2",
			align === "start" ? "items-start" : "items-baseline",
			className,
		)}
	>
		<span className={cx(labelToneClassName[tone], labelClassName)}>
			{label}
		</span>
		<div className={cx("text-right", valueToneClassName[tone], valueClassName)}>
			{value}
		</div>
	</div>
)
