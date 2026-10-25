import type {
	GcmEarthTerrainInput,
	GcmTerrain,
	GcmTerrainCoastlines,
	GcmTerrainDimensions,
	GcmTerrainSummary,
} from "@/model/climate/gcm/terrain/types"

const MAX_PIXELS = 8_388_608

function validateDimensions({ width, height }: GcmTerrainDimensions): void {
	if (
		!Number.isInteger(height) ||
		height < 2 ||
		width !== height * 2 ||
		width * height > MAX_PIXELS
	) {
		throw new Error(
			"Terrain must be a full-world 2:1 raster, at least 4 × 2 and at most 4096 × 2048 pixels",
		)
	}
}

function validate(terrain: GcmTerrain): GcmTerrain {
	validateDimensions(terrain)
	const { width, height, elevationM, land } = terrain
	if (
		!(elevationM instanceof Float32Array) ||
		!(land instanceof Float32Array) ||
		elevationM.length !== width * height ||
		land.length !== elevationM.length
	) {
		throw new Error("Terrain arrays do not match the image dimensions")
	}
	for (let i = 0; i < elevationM.length; i++) {
		if (
			!Number.isFinite(elevationM[i]) ||
			!Number.isFinite(land[i]) ||
			land[i] < 0 ||
			land[i] > 1
		) {
			throw new Error(
				"Terrain requires finite elevations and land coverage between 0 and 1",
			)
		}
	}
	return terrain
}

function fromEarth({ elevation, scale }: GcmEarthTerrainInput): GcmTerrain {
	const elevationM = new Float32Array(elevation.raster.length)
	const land = new Float32Array(elevation.raster.length)
	for (let i = 0; i < land.length; i++) {
		const value = elevation.raster[i]
		elevationM[i] = value === elevation.nodata ? 0 : value * scale
		land[i] = Number(value !== elevation.nodata && elevationM[i] > 0)
	}
	return validate({
		name: "Earth",
		width: elevation.width,
		height: elevation.height,
		elevationM,
		land,
	})
}

function summary(terrain: GcmTerrain): GcmTerrainSummary {
	let minM = Infinity
	let maxM = -Infinity
	let landArea = 0
	let area = 0
	for (let y = 0; y < terrain.height; y++) {
		const weight = Math.cos(((y + 0.5) / terrain.height - 0.5) * Math.PI)
		for (let x = 0; x < terrain.width; x++) {
			const i = y * terrain.width + x
			minM = Math.min(minM, terrain.elevationM[i])
			maxM = Math.max(maxM, terrain.elevationM[i])
			landArea += terrain.land[i] * weight
			area += weight
		}
	}
	return { minM, maxM, landPercent: (100 * landArea) / area }
}

function coastlines(terrain: GcmTerrain): GcmTerrainCoastlines {
	const rings: number[][] = []
	const { width, height, land } = terrain
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const current = land[y * width + x] >= 0.5
			const west = -180 + (x * 360) / width
			const east = -180 + ((x + 1) * 360) / width
			const north = 90 - (y * 180) / height
			const south = 90 - ((y + 1) * 180) / height
			if (current !== land[y * width + ((x + 1) % width)] >= 0.5)
				rings.push([east, north, east, south])
			if (y + 1 < height && current !== land[(y + 1) * width + x] >= 0.5)
				rings.push([west, south, east, south])
		}
	}
	return { rings }
}

export const GCM_TERRAIN = {
	validate,
	validateDimensions,
	fromEarth,
	summary,
	coastlines,
}
