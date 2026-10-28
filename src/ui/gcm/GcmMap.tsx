import { useEffect, useRef } from "react"
import { cx } from "@/ui/components/lib"
import { Button } from "@/ui/components/primitives/Button"
import { EmptyState } from "@/ui/components/primitives/EmptyState"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_FIELD_MAP } from "@/ui/gcm/field-map"
import { GCM_MAP_NAVIGATION } from "@/ui/gcm/map-navigation"
import type { GcmMapNavigation } from "@/ui/gcm/map-navigation/types"
import type { GcmMapProps } from "@/ui/gcm/types"

const CANVAS_WIDTH = 1440
const CANVAS_HEIGHT = 720

export function GcmMap({
	loading,
	readLayer,
	coastlines,
	emptyMessage,
	onHover,
}: GcmMapProps) {
	const layer = loading ? null : readLayer()
	const canvas = useRef<HTMLCanvasElement>(null)
	const navigation = useRef<GcmMapNavigation | null>(null)
	const hoverHandler = useRef(onHover)
	const paint = useRef({ layer, coastlines })
	hoverHandler.current = onHover

	useEffect(() => {
		if (!canvas.current) return
		const target = canvas.current
		const controller = GCM_MAP_NAVIGATION.create({
			canvas: target,
			onView: (viewport) => {
				const current = paint.current
				if (current.layer)
					GCM_FIELD_MAP.paint({
						canvas: target,
						layer: current.layer,
						coastlines: current.coastlines,
						viewport,
					})
			},
			onHover: (point) => hoverHandler.current(point),
		})
		navigation.current = controller
		const resize = () => {
			const bounds = target.getBoundingClientRect()
			const ratio = window.devicePixelRatio || 1
			target.width = Math.max(1, Math.round(bounds.width * ratio))
			target.height = Math.max(1, Math.round(bounds.height * ratio))
			controller.redraw()
		}
		const observer = new ResizeObserver(resize)
		observer.observe(target)
		resize()
		return () => {
			observer.disconnect()
			controller.dispose()
			navigation.current = null
		}
	}, [])

	useEffect(() => {
		paint.current = { layer, coastlines }
		navigation.current?.redraw()
	}, [layer, coastlines])

	return (
		<div
			aria-busy={loading}
			className={cx(
				"relative h-full min-h-0 w-full overflow-hidden border",
				uiTokens.radius.md,
				uiTokens.border.default,
				uiTokens.surface.panelMuted,
			)}
		>
			<canvas
				ref={canvas}
				width={CANVAS_WIDTH}
				height={CANVAS_HEIGHT}
				className={cx("h-full w-full", !layer && "invisible")}
			/>
			{layer && (
				<div className="absolute left-2 top-2 flex gap-1">
					<Button
						tone="overlay"
						aria-label="Zoom in"
						title="Zoom in"
						onClick={() => navigation.current?.zoomIn()}
					>
						+
					</Button>
					<Button
						tone="overlay"
						aria-label="Zoom out"
						title="Zoom out"
						onClick={() => navigation.current?.zoomOut()}
					>
						−
					</Button>
					<Button
						tone="overlay"
						title="Reset map view"
						onClick={() => navigation.current?.reset()}
					>
						Reset view
					</Button>
				</div>
			)}
			{loading && (
				<div
					role="status"
					aria-label="Loading climate map"
					className="absolute inset-0 p-4"
				>
					<div
						aria-hidden="true"
						className="grid h-full grid-cols-4 grid-rows-2 gap-3 motion-safe:animate-pulse"
					>
						{["nw", "north", "ne", "east", "sw", "south", "se", "west"].map(
							(tile) => (
								<div
									key={tile}
									className={cx(uiTokens.radius.md, uiTokens.surface.canvas)}
								/>
							),
						)}
					</div>
					<div
						className={cx(
							"absolute inset-0 flex items-center justify-center",
							uiTokens.type.value,
							uiTokens.text.muted,
						)}
					>
						<span
							className={cx(
								"px-3 py-2",
								uiTokens.radius.sm,
								uiTokens.surface.panel,
							)}
						>
							Preparing climate map…
						</span>
					</div>
				</div>
			)}
			{!loading && !layer && (
				<EmptyState message={emptyMessage} className="absolute inset-0" />
			)}
		</div>
	)
}
