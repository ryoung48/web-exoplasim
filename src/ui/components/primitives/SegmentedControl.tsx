import React from "react"
import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"

interface SegmentedOption<T extends string> {
	value: T
	label: React.ReactNode
	disabled?: boolean
	title?: string
	ariaLabel?: string
}

type SegmentedTone = "panel" | "overlay"
type SegmentedSize = "xs" | "sm" | "md"

const containerClassName: Record<SegmentedTone, string> = {
	panel: "border border-slate-200 bg-slate-100 p-0.5",
	overlay: "border border-white/10 bg-slate-950/75 p-1 backdrop-blur-sm",
}

const buttonToneClassName: Record<
	SegmentedTone,
	{ active: string; idle: string }
> = {
	panel: {
		active: "bg-white text-slate-900 shadow-sm",
		idle: "text-slate-500 hover:text-slate-700",
	},
	overlay: {
		active: "bg-white/15 text-white shadow-sm",
		idle: "text-slate-400 hover:text-slate-200",
	},
}

const buttonSizeClassName: Record<SegmentedSize, string> = {
	xs: "px-1 py-0.5 text-[9px]",
	sm: "px-2 py-1 text-[10px]",
	md: "px-2.5 py-1 text-[10px]",
}

interface SegmentedControlProps<T extends string> {
	options: ReadonlyArray<SegmentedOption<T>>
	value: T
	onChange: (value: T) => void
	isActive?: (value: T) => boolean
	tone?: SegmentedTone
	size?: SegmentedSize
	className?: string
	buttonClassName?: string
	/** Stretches the track to fill its container and gives every option an
	 * equal-width button (grid instead of inline-flex), rather than each
	 * button sizing to its own label. Use when option labels vary a lot in
	 * length and a lopsided, left-packed track would look unbalanced. */
	fullWidth?: boolean
}

export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
	isActive,
	tone = "panel",
	size = "sm",
	className,
	buttonClassName,
	fullWidth,
}: SegmentedControlProps<T>) {
	return (
		<div
			className={cx(
				fullWidth ? "grid w-full" : "inline-flex w-fit",
				"gap-1",
				uiTokens.radius.md,
				containerClassName[tone],
				className,
			)}
			style={
				fullWidth
					? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
					: undefined
			}
		>
			{options.map((option) => {
				const active = isActive
					? isActive(option.value)
					: option.value === value
				return (
					<button
						type="button"
						key={option.value}
						onClick={() => onChange(option.value)}
						disabled={option.disabled}
						title={option.title}
						aria-label={option.ariaLabel}
						className={cx(
							uiTokens.radius.sm,
							"font-semibold uppercase tracking-[0.08em]",
							buttonSizeClassName[size],
							fullWidth && "w-full text-center",
							"transition-all disabled:cursor-not-allowed disabled:opacity-40",
							buttonToneClassName[tone][active ? "active" : "idle"],
							buttonClassName,
						)}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
