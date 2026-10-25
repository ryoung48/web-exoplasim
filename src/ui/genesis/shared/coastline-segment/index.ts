import type { CoastlineSegment } from "@/ui/genesis/shared/coastline-segment/types"

const DATELINE_CLIP_EPS_DEG = 0.05

function isDatelineClipArtifact({
	fromLongitude,
	toLongitude,
}: CoastlineSegment): boolean {
	return (
		Math.abs(Math.abs(fromLongitude) - 180) < DATELINE_CLIP_EPS_DEG &&
		Math.abs(Math.abs(toLongitude) - 180) < DATELINE_CLIP_EPS_DEG
	)
}

export const COASTLINE_SEGMENT = { isDatelineClipArtifact }
