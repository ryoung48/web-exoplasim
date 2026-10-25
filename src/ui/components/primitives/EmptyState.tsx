import React from "react"
import { cx } from "@/ui/components/lib"

interface EmptyStateProps {
	message: React.ReactNode
	minHeight?: number
	centered?: boolean
	className?: string
}

/** Normalized "No data" treatment shared across wiki/preview panels. */
export const EmptyState: React.FC<EmptyStateProps> = ({
	message,
	minHeight,
	centered = true,
	className,
}) => (
	<div
		className={cx(
			"text-[10px] text-slate-400",
			centered ? "flex items-center justify-center text-center" : "",
			className,
		)}
		style={minHeight ? { minHeight } : undefined}
	>
		{message}
	</div>
)
