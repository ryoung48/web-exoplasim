import React from "react"
import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"

interface PanelHeaderProps {
	title: React.ReactNode
	action?: React.ReactNode
	tone?: "panel" | "overlay"
	className?: string
}

const titleToneClassName = {
	panel: `${uiTokens.type.controlWide} ${uiTokens.text.muted}`,
	overlay: `${uiTokens.type.controlWide} ${uiTokens.text.inverseMuted}`,
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
	title,
	action,
	tone = "panel",
	className,
}) => (
	<div
		className={cx("mb-3 flex items-center justify-between gap-3", className)}
	>
		<span className={titleToneClassName[tone]}>{title}</span>
		{action}
	</div>
)
