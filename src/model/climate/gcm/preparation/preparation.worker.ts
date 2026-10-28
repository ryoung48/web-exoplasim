import { GCM_BOUNDARY } from "@/model/climate/gcm/boundary"
import { GCM_DOWNSCALE } from "@/model/climate/gcm/downscale"
import type {
	GcmPreparationMessage,
	GcmPreparationResponse,
} from "@/model/climate/gcm/preparation/types"

self.onmessage = ({ data }: MessageEvent<GcmPreparationMessage>) => {
	try {
		if (data.kind === "boundary") {
			self.postMessage({
				type: "prepared",
				result: GCM_BOUNDARY.files(GCM_BOUNDARY.fromTerrain(data.input)),
			} satisfies GcmPreparationResponse)
		} else {
			const result = GCM_DOWNSCALE.create(data.input)
			self.postMessage(
				{ type: "prepared", result } satisfies GcmPreparationResponse,
				{
					transfer: [
						result.elevationM.buffer,
						result.land.buffer,
						result.modelElevationM.buffer,
						result.cellElevationM.buffer,
						result.corners.buffer,
						result.weights.buffer,
						result.grid.latitudesDeg.buffer,
						result.grid.latitudeSines.buffer,
						result.grid.latitudeWeights.buffer,
					],
				},
			)
		}
	} catch (error) {
		self.postMessage({
			type: "failed",
			message: error instanceof Error ? error.message : String(error),
		} satisfies GcmPreparationResponse)
	}
}
