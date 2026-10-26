import type { ReactNode } from "react"

export type TooltipPosition = "top" | "bottom"
export type TooltipAlign = "start" | "center" | "end"

export interface TooltipProps {
	content: ReactNode
	children: ReactNode
	// [JUSTIFICATION] Existing triggers can use the default placement.
	position?: TooltipPosition
	// [JUSTIFICATION] Existing triggers can use the default alignment.
	align?: TooltipAlign
	// [JUSTIFICATION] Most tooltips use the shared appearance without overrides.
	className?: string
	// [JUSTIFICATION] Help triggers supply an ID for their accessible description.
	id?: string
}

export interface TooltipLocation {
	left: number
	top: number
}

export interface InputLabelProps {
	// [JUSTIFICATION] Associated HTML labels can supply their text for the help trigger.
	name?: string
	label: ReactNode
	help: string
}
