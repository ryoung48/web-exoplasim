import { useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cx } from "@/ui/components/lib"
import type {
	TooltipLocation,
	TooltipProps,
} from "@/ui/components/primitives/tooltip/types"
import { uiTokens } from "@/ui/components/tokens"

const OPEN_EVENT = "ui-tooltip-open"

export function Tooltip({
	content,
	position = "bottom",
	align = "start",
	className,
	children,
	id,
}: TooltipProps) {
	const generatedId = useId()
	const tooltipId = id ?? generatedId
	const anchor = useRef<HTMLDivElement>(null)
	const bubble = useRef<HTMLDivElement>(null)
	const [open, setOpen] = useState(false)
	const [location, setLocation] = useState<TooltipLocation | null>(null)
	useLayoutEffect(() => {
		if (!open || !anchor.current || !bubble.current) return
		const updateLocation = () => {
			if (!anchor.current || !bubble.current) return
			const target = anchor.current.getBoundingClientRect()
			const bounds = bubble.current.getBoundingClientRect()
			const { gap, viewportInset } = uiTokens.tooltip
			const dialog = anchor.current.closest("dialog[open]")
			const container = dialog?.getBoundingClientRect()
			const leftEdge = Math.max(
				viewportInset,
				(container?.left ?? 0) + viewportInset,
			)
			const rightEdge = Math.min(
				window.innerWidth - viewportInset,
				(container?.right ?? window.innerWidth) - viewportInset,
			)
			const topEdge = Math.max(
				viewportInset,
				(container?.top ?? 0) + viewportInset,
			)
			const bottomEdge = Math.min(
				window.innerHeight - viewportInset,
				(container?.bottom ?? window.innerHeight) - viewportInset,
			)
			const below = target.bottom + gap
			const above = target.top - gap - bounds.height
			const preferred = position === "bottom" ? below : above
			const alternate = position === "bottom" ? above : below
			const top =
				preferred >= topEdge && preferred + bounds.height <= bottomEdge
					? preferred
					: alternate
			const left =
				align === "end"
					? target.right - bounds.width
					: align === "center"
						? target.left + (target.width - bounds.width) / 2
						: target.left
			setLocation({
				left: Math.max(leftEdge, Math.min(left, rightEdge - bounds.width)),
				top: Math.max(topEdge, Math.min(top, bottomEdge - bounds.height)),
			})
		}
		updateLocation()
		const close = () => setOpen(false)
		const anotherOpened = (event: Event) => {
			if (event instanceof CustomEvent && event.detail !== tooltipId) close()
		}
		const outside = (event: PointerEvent) => {
			if (
				!anchor.current?.contains(event.target as Node) &&
				!bubble.current?.contains(event.target as Node)
			)
				close()
		}
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") close()
		}
		window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: tooltipId }))
		window.addEventListener(OPEN_EVENT, anotherOpened)
		window.addEventListener("scroll", updateLocation, true)
		window.addEventListener("resize", updateLocation)
		window.addEventListener("pointerdown", outside, true)
		window.addEventListener("keydown", handleEscape)
		return () => {
			window.removeEventListener(OPEN_EVENT, anotherOpened)
			window.removeEventListener("scroll", updateLocation, true)
			window.removeEventListener("resize", updateLocation)
			window.removeEventListener("pointerdown", outside, true)
			window.removeEventListener("keydown", handleEscape)
		}
	}, [open, position, align, tooltipId])
	return (
		<div
			ref={anchor}
			className={uiTokens.tooltip.anchor}
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={(event) => {
				if (
					!anchor.current?.contains(document.activeElement) &&
					!(
						event.relatedTarget instanceof Node &&
						bubble.current?.contains(event.relatedTarget)
					)
				)
					setOpen(false)
			}}
			onFocusCapture={() => setOpen(true)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
			}}
			onClick={() => setOpen(true)}
		>
			{children}
			{open &&
				createPortal(
					<div
						ref={bubble}
						id={tooltipId}
						role="tooltip"
						className={cx(uiTokens.tooltip.body, className)}
						style={{
							left: location?.left ?? 0,
							top: location?.top ?? 0,
							visibility: location ? "visible" : "hidden",
							maxWidth: anchor.current?.closest("dialog[open]")
								? `calc(min(100vw, ${anchor.current.closest("dialog[open]")?.clientWidth}px) - ${2 * uiTokens.tooltip.viewportInset}px)`
								: undefined,
						}}
					>
						{content}
					</div>,
					anchor.current?.closest("dialog[open]") ?? document.body,
				)}
		</div>
	)
}
