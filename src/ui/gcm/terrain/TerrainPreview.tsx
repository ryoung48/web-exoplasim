import { useEffect, useRef } from "react"
import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_TERRAIN_PREVIEW } from "@/ui/gcm/terrain/preview"
import type { GcmTerrainPreviewProps } from "@/ui/gcm/terrain/types"

export function TerrainPreview({
	terrain,
	boundary,
	label,
}: GcmTerrainPreviewProps) {
	const canvas = useRef<HTMLCanvasElement>(null)
	useEffect(() => {
		if (canvas.current)
			GCM_TERRAIN_PREVIEW.paint({
				terrain,
				boundary,
				label,
				canvas: canvas.current,
			})
	}, [terrain, boundary, label])
	return (
		<figure className="space-y-1">
			<canvas
				ref={canvas}
				role="img"
				aria-label={label}
				className={cx(
					"aspect-[2/1] w-full border",
					uiTokens.border.default,
					uiTokens.radius.sm,
				)}
			/>
			<figcaption className={uiTokens.type.valueSm}>{label}</figcaption>
		</figure>
	)
}
