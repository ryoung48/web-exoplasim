import { KOPPEN } from "@/model/climate/classification/koppen"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import { uiPalette } from "@/ui/components/tokens"
import { GCM_DISPLAY } from "@/ui/gcm/field-display"
import { GCM_FIELD_SAMPLE } from "@/ui/gcm/field-sample"
import type { GcmMapViewport } from "@/ui/gcm/map-navigation/types"
import type {
	GcmClassPaint,
	GcmFieldPaint,
	GcmMapPaint,
	GcmRasterPaint,
} from "@/ui/gcm/types"
import { COASTLINE_SEGMENT } from "@/ui/genesis/shared/coastline-segment"

const VECTOR_COLUMNS = 32
const VECTOR_FULL_LENGTH_FRACTION = 0.9
const COASTLINE_WIDTH = 1
const VECTOR_WIDTH = 1.25

const raster = document.createElement("canvas")
let cachedLayer: GcmMapPaint["layer"] | null = null
// Coastlines change only with the view, so they are stroked into this
// canvas once and copied on every redraw: stroking every segment each frame
// competed with the model for the GPU.
const coastlineLayer = document.createElement("canvas")
let coastlineKey = ""

function wrapOffsets(viewport: GcmMapViewport): number[] {
	const first = Math.floor((viewport.west + 180) / 360)
	const last = Math.floor((viewport.west + viewport.longitudeSpan + 180) / 360)
	return Array.from(
		{ length: last - first + 1 },
		(_, index) => (first + index) * 360,
	)
}

function paintField({ snapshot, mode }: GcmFieldPaint) {
	const grid = GCM_FIELDS.grid(snapshot)
	const { longitudes } = grid
	if (raster.width !== longitudes) raster.width = longitudes
	if (raster.height !== GCM_FIELD_SAMPLE.RASTER_ROWS)
		raster.height = GCM_FIELD_SAMPLE.RASTER_ROWS
	const context = raster.getContext("2d") as CanvasRenderingContext2D
	const image = context.createImageData(
		longitudes,
		GCM_FIELD_SAMPLE.RASTER_ROWS,
	)
	const values = GCM_FIELDS.values({ snapshot, mode })
	for (let y = 0; y < GCM_FIELD_SAMPLE.RASTER_ROWS; y++) {
		const latitude = 90 - ((y + 0.5) / GCM_FIELD_SAMPLE.RASTER_ROWS) * 180
		const [north, south, t] = GCM_FIELD_SAMPLE.rowBlend({ grid, latitude })
		for (let x = 0; x < longitudes; x++) {
			const column = GCM_FIELD_SAMPLE.modelColumn({ grid, column: x })
			const value =
				values[north * longitudes + column] * (1 - t) +
				values[south * longitudes + column] * t
			const [r, g, b] = GCM_DISPLAY.color({ mode, value })
			const offset = (y * longitudes + x) * 4
			image.data[offset] = r * 255
			image.data[offset + 1] = g * 255
			image.data[offset + 2] = b * 255
			image.data[offset + 3] = 255
		}
	}
	context.putImageData(image, 0, 0)
}

function paintClasses({ snapshot, classes }: GcmClassPaint) {
	const grid = GCM_FIELDS.grid(snapshot)
	const { longitudes } = grid
	if (raster.width !== longitudes) raster.width = longitudes
	if (raster.height !== GCM_FIELD_SAMPLE.RASTER_ROWS)
		raster.height = GCM_FIELD_SAMPLE.RASTER_ROWS
	const context = raster.getContext("2d") as CanvasRenderingContext2D
	const image = context.createImageData(
		longitudes,
		GCM_FIELD_SAMPLE.RASTER_ROWS,
	)
	for (let y = 0; y < GCM_FIELD_SAMPLE.RASTER_ROWS; y++) {
		const latitude = 90 - ((y + 0.5) / GCM_FIELD_SAMPLE.RASTER_ROWS) * 180
		const [north, south, t] = GCM_FIELD_SAMPLE.rowBlend({ grid, latitude })
		const row = t < 0.5 ? north : south
		for (let x = 0; x < longitudes; x++) {
			const classId =
				classes[
					row * longitudes + GCM_FIELD_SAMPLE.modelColumn({ grid, column: x })
				]
			const [r, g, b] = KOPPEN.koppenClimateColor(classId)
			const offset = (y * longitudes + x) * 4
			image.data[offset] = r * 255
			image.data[offset + 1] = g * 255
			image.data[offset + 2] = b * 255
			image.data[offset + 3] = 255
		}
	}
	context.putImageData(image, 0, 0)
}

function paintRaster({ width, height, color }: GcmRasterPaint) {
	if (raster.width !== width) raster.width = width
	if (raster.height !== height) raster.height = height
	const context = raster.getContext("2d") as CanvasRenderingContext2D
	const image = context.createImageData(width, height)
	for (let index = 0; index < width * height; index++) {
		const [r, g, b] = color(index)
		image.data[index * 4] = r * 255
		image.data[index * 4 + 1] = g * 255
		image.data[index * 4 + 2] = b * 255
		image.data[index * 4 + 3] = 255
	}
	context.putImageData(image, 0, 0)
}

function paintCoastlines(paint: GcmMapPaint) {
	const { canvas, coastlines, viewport } = paint
	if (!coastlines) return
	const { width, height } = canvas
	const key = [
		coastlines.rings.length,
		width,
		height,
		canvas.clientWidth,
		viewport.west,
		viewport.north,
		viewport.longitudeSpan,
		viewport.latitudeSpan,
	].join()
	if (key !== coastlineKey) {
		coastlineKey = key
		coastlineLayer.width = width
		coastlineLayer.height = height
		strokeCoastlines(paint)
	}
	;(canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(
		coastlineLayer,
		0,
		0,
	)
}

function strokeCoastlines({ canvas, coastlines, viewport }: GcmMapPaint) {
	if (!coastlines) return
	const context = coastlineLayer.getContext("2d") as CanvasRenderingContext2D
	const { width, height } = canvas
	context.strokeStyle = uiPalette.fieldMap.coastline
	context.lineWidth = (COASTLINE_WIDTH * canvas.width) / canvas.clientWidth
	context.beginPath()
	for (const shift of wrapOffsets({
		...viewport,
		west: viewport.west - 360,
		longitudeSpan: viewport.longitudeSpan + 720,
	})) {
		for (const ring of coastlines.rings) {
			for (let index = 2; index < ring.length; index += 2) {
				const fromLongitude = ring[index - 2]
				const toLongitude = ring[index]
				if (
					COASTLINE_SEGMENT.isDatelineClipArtifact({
						fromLongitude,
						toLongitude,
					})
				)
					continue
				const delta = ((toLongitude - fromLongitude + 540) % 360) - 180
				context.moveTo(
					((fromLongitude + shift - viewport.west) / viewport.longitudeSpan) *
						width,
					((viewport.north - ring[index - 1]) / viewport.latitudeSpan) * height,
				)
				context.lineTo(
					((fromLongitude + delta + shift - viewport.west) /
						viewport.longitudeSpan) *
						width,
					((viewport.north - ring[index + 1]) / viewport.latitudeSpan) * height,
				)
			}
		}
	}
	context.stroke()
}

function paintVectors({ canvas, snapshot, mode, viewport }: GcmFieldPaint) {
	const vectors = GCM_FIELDS.vectors({ snapshot, mode })
	if (!vectors) return
	const grid = GCM_FIELDS.grid(snapshot)
	const stride = Math.max(
		1,
		Math.round(
			(grid.longitudes * viewport.longitudeSpan) / (VECTOR_COLUMNS * 360),
		),
	)
	const context = canvas.getContext("2d") as CanvasRenderingContext2D
	const { width, height } = canvas
	const { max } = GCM_FIELDS.definition(mode)
	const cell = Math.min(
		width / VECTOR_COLUMNS,
		((width / grid.longitudes) * stride * 360) / viewport.longitudeSpan,
	)
	context.lineWidth = (VECTOR_WIDTH * canvas.width) / canvas.clientWidth
	context.lineCap = "round"
	for (let row = 0; row < grid.latitudes; row += stride) {
		const y =
			((viewport.north - grid.latitudesDeg[row]) / viewport.latitudeSpan) *
			height
		if (y < -cell || y > height + cell) continue
		for (const shift of wrapOffsets(viewport)) {
			for (let x = 0; x < grid.longitudes; x += stride) {
				const index =
					row * grid.longitudes +
					GCM_FIELD_SAMPLE.modelColumn({ grid, column: x })
				const u = vectors.u[index]
				const v = vectors.v[index]
				const length = Math.min(1, Math.hypot(u, v) / max)
				if (length === 0) continue
				const angle = Math.atan2(-v, u)
				const reach = length * cell * VECTOR_FULL_LENGTH_FRACTION
				const longitude = ((x + 0.5) / grid.longitudes) * 360 - 180 + shift
				const centerX =
					((longitude - viewport.west) / viewport.longitudeSpan) * width
				if (centerX < -cell || centerX > width + cell) continue
				const dx = Math.cos(angle) * reach
				const dy = Math.sin(angle) * reach
				for (const [style, shift] of [
					[uiPalette.fieldMap.vectorShadow, 1],
					[uiPalette.fieldMap.vector, 0],
				] as const) {
					context.strokeStyle = style
					context.beginPath()
					context.moveTo(centerX - dx / 2 + shift, y - dy / 2 + shift)
					context.lineTo(centerX + dx / 2 + shift, y + dy / 2 + shift)
					context.lineTo(
						centerX + dx / 2 - Math.cos(angle - 0.5) * reach * 0.35 + shift,
						y + dy / 2 - Math.sin(angle - 0.5) * reach * 0.35 + shift,
					)
					context.stroke()
				}
			}
		}
	}
}

export const GCM_FIELD_MAP = {
	paint(paint: GcmMapPaint) {
		const { canvas, layer, viewport } = paint
		const context = canvas.getContext("2d") as CanvasRenderingContext2D
		if (cachedLayer !== layer) {
			if (layer.kind === "field") paintField({ canvas, ...layer, viewport })
			else if (layer.kind === "classes") paintClasses(layer)
			else if (layer.kind === "downscaled-field") {
				const { mode, values } = layer
				paintRaster({
					width: layer.width,
					height: layer.height,
					color: (index) => GCM_DISPLAY.color({ mode, value: values[index] }),
				})
			} else {
				const { classes } = layer
				paintRaster({
					width: layer.width,
					height: layer.height,
					color: (index) => KOPPEN.koppenClimateColor(classes[index]),
				})
			}
			cachedLayer = layer
		}
		context.clearRect(0, 0, canvas.width, canvas.height)
		context.imageSmoothingEnabled = false
		const width = (canvas.width * 360) / viewport.longitudeSpan
		const height = (canvas.height * 180) / viewport.latitudeSpan
		for (const shift of wrapOffsets(viewport)) {
			const left = Math.round(((-180 + shift - viewport.west) / 360) * width)
			const right = Math.round(((180 + shift - viewport.west) / 360) * width)
			context.drawImage(
				raster,
				left,
				((viewport.north - 90) / 180) * height,
				right - left,
				height,
			)
		}
		paintCoastlines(paint)
		if (layer.kind === "field" || layer.kind === "downscaled-field") {
			paintVectors({
				canvas,
				snapshot: layer.snapshot,
				mode: layer.mode,
				viewport,
			})
		}
	},
}
