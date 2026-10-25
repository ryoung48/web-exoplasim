import React from "react"
import { cx } from "@/ui/components/lib"
import { uiPalette } from "@/ui/components/tokens"

type SwatchShape = "square" | "round"
type SwatchSize = "sm" | "md"

const shapeClassName: Record<SwatchShape, string> = {
	square: "rounded-sm",
	round: "rounded-full",
}

const sizeClassName: Record<SwatchSize, string> = {
	sm: "h-1.5 w-1.5",
	md: "h-2 w-2",
}

interface SwatchProps extends React.HTMLAttributes<HTMLSpanElement> {
	color: string | null
	striped?: boolean
	stripeBackground?: string
	shape?: SwatchShape
	size?: SwatchSize
}

export const Swatch: React.FC<SwatchProps> = ({
	color,
	striped = false,
	stripeBackground = uiPalette.swatch.stripeBackground,
	shape = "square",
	size = "sm",
	className,
	style,
	...props
}) =>
	color ? (
		<span
			className={cx(
				"border",
				sizeClassName[size],
				shapeClassName[shape],
				className,
			)}
			style={{
				borderColor: striped
					? uiPalette.swatch.stripedBorder
					: uiPalette.swatch.plainBorder,
				...(striped
					? {
							backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, ${stripeBackground} 2px 4px)`,
						}
					: { backgroundColor: color }),
				...style,
			}}
			{...props}
		/>
	) : null
