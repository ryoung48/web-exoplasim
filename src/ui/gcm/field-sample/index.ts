import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmFieldSampleRequest } from "@/ui/gcm/field-sample/types"
import type {
	GcmColumnLookup,
	GcmLatitudeLookup,
	GcmMapLayer,
} from "@/ui/gcm/types"

const RASTER_ROWS = 180
const fields = new WeakMap<GcmMapLayer, Float32Array>()

function modelColumn({ grid, column }: GcmColumnLookup): number {
	return (column + grid.longitudes / 2) % grid.longitudes
}

function rowBlend({
	grid,
	latitude,
}: GcmLatitudeLookup): [number, number, number] {
	const latitudes = grid.latitudesDeg
	if (latitude >= latitudes[0]) return [0, 0, 0]
	const last = latitudes.length - 1
	if (latitude <= latitudes[last]) return [last, last, 0]
	let row = 0
	while (latitudes[row + 1] > latitude) row++
	const t = (latitudes[row] - latitude) / (latitudes[row] - latitudes[row + 1])
	return [row, row + 1, t]
}

function value({ layer, point }: GcmFieldSampleRequest): number {
	const longitude = (((point.longitude + 180) % 360) + 360) % 360
	if (
		layer.kind === "downscaled-field" ||
		layer.kind === "downscaled-classes"
	) {
		const column = Math.min(
			layer.width - 1,
			Math.floor((longitude / 360) * layer.width),
		)
		const row = Math.max(
			0,
			Math.min(
				layer.height - 1,
				Math.floor(((90 - point.latitude) / 180) * layer.height),
			),
		)
		const index = row * layer.width + column
		return layer.kind === "downscaled-field"
			? layer.values[index]
			: layer.classes[index]
	}
	const grid = GCM_FIELDS.grid(layer.snapshot)
	const column = modelColumn({
		grid,
		column: Math.floor((longitude / 360) * grid.longitudes),
	})
	const y = Math.max(
		0,
		Math.min(
			RASTER_ROWS - 1,
			Math.floor(((90 - point.latitude) / 180) * RASTER_ROWS),
		),
	)
	const latitude = 90 - ((y + 0.5) / RASTER_ROWS) * 180
	const [north, south, t] = rowBlend({ grid, latitude })
	if (layer.kind === "classes")
		return layer.classes[(t < 0.5 ? north : south) * grid.longitudes + column]
	let values = fields.get(layer)
	if (!values) {
		values = GCM_FIELDS.values(layer)
		fields.set(layer, values)
	}
	return (
		values[north * grid.longitudes + column] * (1 - t) +
		values[south * grid.longitudes + column] * t
	)
}

export const GCM_FIELD_SAMPLE = { RASTER_ROWS, modelColumn, rowBlend, value }
