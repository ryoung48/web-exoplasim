import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import { GCM_BOUNDARY } from "@/model/climate/gcm/boundary"
import { GCM_CHECKPOINT } from "@/model/climate/gcm/checkpoint"
import { GCM_CLASSIFICATION } from "@/model/climate/gcm/classification"
import { GCM_DOWNSCALE } from "@/model/climate/gcm/downscale"
import type {
	GcmPreparationMessage,
	GcmPreparationResponse,
} from "@/model/climate/gcm/preparation/types"

self.onmessage = async ({ data }: MessageEvent<GcmPreparationMessage>) => {
	try {
		if (data.kind === "checkpoint") {
			const checkpoint = GCM_CHECKPOINT.decode(await data.input.arrayBuffer())
			const { diagnostics, terrain, meta } = checkpoint
			const averages = GCM_AVERAGES.view({
				averager: diagnostics.averager,
				config: meta.config,
			})
			const buffers = new Set<ArrayBufferLike>([
				checkpoint.restart,
				terrain.elevationM.buffer,
				terrain.land.buffer,
				diagnostics.snapshot.values.buffer,
				...diagnostics.averager.months.map(
					({ snapshot }) => snapshot.values.buffer,
				),
				...averages.climateMonths.map(({ snapshot }) => snapshot.values.buffer),
			])
			const current = diagnostics.averager.current
			if (current) {
				buffers.add(current.last.values.buffer)
				buffers.add(current.sum.buffer)
			}
			if (averages.annual) buffers.add(averages.annual.values.buffer)
			if (averages.koppen) buffers.add(averages.koppen.buffer)
			if (averages.pasta) buffers.add(averages.pasta.buffer)
			self.postMessage(
				{
					type: "prepared",
					result: { checkpoint, averages },
				} satisfies GcmPreparationResponse,
				{ transfer: [...buffers] },
			)
		} else if (data.kind === "boundary") {
			self.postMessage({
				type: "prepared",
				result: GCM_BOUNDARY.files(GCM_BOUNDARY.fromTerrain(data.input)),
			} satisfies GcmPreparationResponse)
		} else if (data.kind === "classification") {
			const result = GCM_CLASSIFICATION.classes(data.input)
			self.postMessage(
				{ type: "prepared", result } satisfies GcmPreparationResponse,
				{ transfer: result ? [result.buffer] : [] },
			)
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
