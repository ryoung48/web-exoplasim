import React from "react"
import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"

type IconButtonTone = "panel" | "overlay" | "borderless"
type IconButtonSize = "sm" | "md" | "xs"
type IconButtonShape = "rounded" | "pill"

const toneClassName: Record<IconButtonTone, { active: string; idle: string }> =
	{
		panel: {
			active: "border-slate-300 bg-slate-900 text-white shadow-sm",
			idle: "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
		},
		overlay: {
			active: "border-white/20 bg-white/15 text-white",
			idle: "border-white/10 bg-slate-950/80 text-slate-200 hover:bg-slate-950/95",
		},
		borderless: {
			active: "border-transparent text-slate-700",
			idle: "border-transparent text-slate-400 hover:text-slate-700",
		},
	}

const sizeClassName: Record<IconButtonSize, string> = {
	xs: "h-3.5 w-3.5",
	sm: "h-8 w-8",
	md: "h-9 w-9",
}

const shapeClassName: Record<IconButtonShape, string> = {
	rounded: uiTokens.radius.md,
	pill: uiTokens.radius.pill,
}

interface IconButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	tone?: IconButtonTone
	selected?: boolean
	size?: IconButtonSize
	shape?: IconButtonShape
}

export const IconButton: React.FC<IconButtonProps> = ({
	tone = "overlay",
	selected = false,
	size = "md",
	shape = "pill",
	className,
	type = "button",
	...props
}) => (
	<button
		type={type}
		className={cx(
			"flex items-center justify-center border transition-all disabled:cursor-not-allowed disabled:opacity-30",
			tone === "borderless" ? "" : "shadow-lg backdrop-blur-md",
			sizeClassName[size],
			shapeClassName[shape],
			toneClassName[tone][selected ? "active" : "idle"],
			className,
		)}
		{...props}
	/>
)
