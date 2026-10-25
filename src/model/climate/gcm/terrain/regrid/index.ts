import type {
	GcmTerrainCell,
	GcmTerrainCellRequest,
} from "@/model/climate/gcm/terrain/regrid/types"

function cell({
	terrain,
	north,
	south,
	west,
	east,
}: GcmTerrainCellRequest): GcmTerrainCell {
	const { width, height, elevationM, land } = terrain
	const top = ((90 - north) * height) / 180
	const bottom = ((90 - south) * height) / 180
	const left = ((west + 180) * width) / 360
	const right = ((east + 180) * width) / 360
	let area = 0
	let landArea = 0
	let elevationSum = 0
	for (
		let y = Math.max(0, Math.floor(top));
		y < Math.ceil(bottom) && y < height;
		y++
	) {
		const pixelNorth = 90 - (Math.max(top, y) * 180) / height
		const pixelSouth = 90 - (Math.min(bottom, y + 1) * 180) / height
		const latitudeWeight =
			Math.sin((pixelNorth * Math.PI) / 180) -
			Math.sin((pixelSouth * Math.PI) / 180)
		for (let x = Math.floor(left); x < Math.ceil(right); x++) {
			const weight =
				latitudeWeight * (Math.min(right, x + 1) - Math.max(left, x))
			const i = y * width + (((x % width) + width) % width)
			area += weight
			landArea += weight * land[i]
			elevationSum += weight * land[i] * elevationM[i]
		}
	}
	return {
		landFraction: Math.min(1, Math.max(0, landArea / area)),
		elevationM: elevationSum / area,
	}
}

export const GCM_TERRAIN_REGRID = { cell }
