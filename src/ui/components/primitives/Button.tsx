import React from "react"
import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"

type ButtonTone = "panel" | "overlay"
type ButtonShape = "rounded" | "pill"
type ButtonSize = "sm" | "md"

const toneClassName: Record<ButtonTone, { active: string; idle: string }> = {
	panel: {
		active: "border-slate-900 bg-slate-900 text-white shadow-sm",
		idle: "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
	},
	overlay: {
		active: "border-white/20 bg-white/15 text-white shadow-sm",
		idle: "border-white/10 bg-slate-950/80 text-slate-200 hover:bg-slate-950/95",
	},
}

const sizeClassName: Record<ButtonSize, string> = {
	sm: "px-2 py-1 text-[10px]",
	md: "px-3 py-2 text-[10px]",
}

const shapeClassName: Record<ButtonShape, string> = {
	rounded: uiTokens.radius.md,
	pill: uiTokens.radius.pill,
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	tone?: ButtonTone
	selected?: boolean
	shape?: ButtonShape
	size?: ButtonSize
}

export const Button: React.FC<ButtonProps> = ({
	tone = "panel",
	selected = false,
	shape = "rounded",
	size = "sm",
	className,
	type = "button",
	...props
}) => (
	<button
		type={type}
		className={cx(
			"border transition-all disabled:cursor-not-allowed disabled:opacity-30",
			uiTokens.type.control,
			shapeClassName[shape],
			sizeClassName[size],
			toneClassName[tone][selected ? "active" : "idle"],
			className,
		)}
		{...props}
	/>
)
