import type { GcmTerrainPaint } from "@/ui/gcm/terrain/types"

function paint({ canvas, terrain, boundary }: GcmTerrainPaint) {
	const width = Math.min(720, terrain.width)
	const height = width / 2
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext("2d")
	if (!context) return
	const image = context.createImageData(width, height)
	for (let y = 0; y < height; y++) {
		const latitude = 90 - ((y + 0.5) * 180) / height
		let row = 0
		if (boundary)
			while (
				row < boundary.grid.latitudes - 1 &&
				latitude <
					(boundary.grid.latitudesDeg[row] +
						boundary.grid.latitudesDeg[row + 1]) /
						2
			)
				row++
		for (let x = 0; x < width; x++) {
			const i =
				Math.floor(((y + 0.5) * terrain.height) / height) * terrain.width +
				Math.floor(((x + 0.5) * terrain.width) / width)
			const cell = boundary
				? row * boundary.grid.longitudes +
					Math.floor(
						(((x + 0.5) / width) * boundary.grid.longitudes +
							boundary.grid.longitudes / 2 +
							0.5) %
							boundary.grid.longitudes,
					)
				: 0
			const land = boundary ? boundary.landFraction[cell] : terrain.land[i]
			const shade = land >= 0.5 ? 255 : 0
			for (let channel = 0; channel < 3; channel++) {
				image.data[(y * width + x) * 4 + channel] = shade
			}
			image.data[(y * width + x) * 4 + 3] = 255
		}
	}
	context.putImageData(image, 0, 0)
}

export const GCM_TERRAIN_PREVIEW = { paint }
