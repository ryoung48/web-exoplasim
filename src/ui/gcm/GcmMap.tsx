import { useEffect, useRef, useState } from "react"
import { cx } from "@/ui/components/lib"
import { EmptyState } from "@/ui/components/primitives/EmptyState"
import { IconButton } from "@/ui/components/primitives/IconButton"
import { FileImageIcon } from "@/ui/components/primitives/icons/FileImageIcon"
import { MinusIcon } from "@/ui/components/primitives/icons/MinusIcon"
import { PlusIcon } from "@/ui/components/primitives/icons/PlusIcon"
import { RefreshIcon } from "@/ui/components/primitives/icons/RefreshIcon"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_DOWNLOAD } from "@/ui/gcm/download"
import { GCM_FIELD_MAP } from "@/ui/gcm/field-map"
import { GCM_MAP_NAVIGATION } from "@/ui/gcm/map-navigation"
import type { GcmMapNavigation } from "@/ui/gcm/map-navigation/types"
import type { GcmMapProps } from "@/ui/gcm/types"

const CANVAS_WIDTH = 1440
const CANVAS_HEIGHT = 720

export function GcmMap({
	loading,
	readLayer,
	readCoastlines,
	emptyMessage,
	onHover,
}: GcmMapProps) {
	const layer = loading ? null : readLayer()
	const coastlines = readCoastlines()
	const hasMap = Boolean(layer || (!loading && coastlines))
	const canvas = useRef<HTMLCanvasElement>(null)
	const [exporting, setExporting] = useState(false)
	const [exportError, setExportError] = useState("")
	const navigation = useRef<GcmMapNavigation | null>(null)
	const hoverHandler = useRef(onHover)
	const paint = useRef({ layer, coastlines })
	hoverHandler.current = onHover

	const exportPng = async () => {
		if (!canvas.current || !layer) return
		setExporting(true)
		setExportError("")
		try {
			await GCM_DOWNLOAD.png(canvas.current)
		} catch {
			setExportError("Unable to export map. Please try again.")
		} finally {
			setExporting(false)
		}
	}

	useEffect(() => {
		if (!canvas.current) return
		const target = canvas.current
		const controller = GCM_MAP_NAVIGATION.create({
			canvas: target,
			onView: (viewport) => {
				const current = paint.current
				if (current.layer || current.coastlines)
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
				className={cx("h-full w-full", !hasMap && "invisible")}
			/>
			{hasMap && (
				<div className="absolute left-2 top-2 flex gap-1">
					<IconButton
						tone="overlay"
						size="sm"
						shape="rounded"
						aria-label="Zoom in"
						title="Zoom in"
						onClick={() => navigation.current?.zoomIn()}
					>
						<PlusIcon className="h-4 w-4" />
					</IconButton>
					<IconButton
						tone="overlay"
						size="sm"
						shape="rounded"
						aria-label="Zoom out"
						title="Zoom out"
						onClick={() => navigation.current?.zoomOut()}
					>
						<MinusIcon className="h-4 w-4" />
					</IconButton>
					<IconButton
						tone="overlay"
						size="sm"
						shape="rounded"
						title="Reset map view"
						aria-label="Reset map view"
						onClick={() => navigation.current?.reset()}
					>
						<RefreshIcon className="h-4 w-4" />
					</IconButton>
					{layer && (
						<IconButton
							tone="overlay"
							size="sm"
							shape="rounded"
							title="Export map as PNG"
							aria-label="Export map as PNG"
							aria-busy={exporting}
							disabled={exporting}
							onClick={exportPng}
						>
							<FileImageIcon className="h-4 w-4" />
						</IconButton>
					)}
				</div>
			)}
			{exportError && (
				<div
					role="alert"
					className={cx(
						"absolute bottom-2 left-2 px-3 py-2",
						uiTokens.radius.sm,
						uiTokens.surface.panel,
						uiTokens.type.control,
					)}
				>
					{exportError}
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
			{!loading && !hasMap && (
				<EmptyState message={emptyMessage} className="absolute inset-0" />
			)}
		</div>
	)
}
