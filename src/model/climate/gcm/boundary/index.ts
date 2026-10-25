import type {
	GcmBoundary,
	GcmBoundaryRequest,
	GcmRowLookup,
	GcmSraField,
} from "@/model/climate/gcm/boundary/types"

const STANDARD_GRAVITY = 9.80665
const LAND_SEA_CODE = 172
const OROGRAPHY_CODE = 129
const SRA_VALUES_PER_LINE = 8

function modelRow({ grid, latitude }: GcmRowLookup): number {
	const latitudes = grid.latitudesDeg
	let row = 0
	while (
		row < grid.latitudes - 1 &&
		latitude < (latitudes[row] + latitudes[row + 1]) / 2
	) {
		row++
	}
	return row
}

function fromElevation({ grid, elevation }: GcmBoundaryRequest): GcmBoundary {
	const { raster, width, height, nodata } = elevation
	const land = new Float64Array(grid.points)
	const elevationSum = new Float64Array(grid.points)
	const area = new Float64Array(grid.points)
	const columns = new Int32Array(width)
	for (let x = 0; x < width; x++) {
		const longitude = ((x + 0.5) / width) * 360 - 180
		const shifted = (longitude + grid.longitudeStepDeg / 2 + 360) % 360
		columns[x] = Math.floor(shifted / grid.longitudeStepDeg) % grid.longitudes
	}
	for (let y = 0; y < height; y++) {
		const latitude = 90 - ((y + 0.5) / height) * 180
		const weight = Math.cos((latitude * Math.PI) / 180)
		const rowOffset = modelRow({ grid, latitude }) * grid.longitudes
		for (let x = 0; x < width; x++) {
			const value = raster[y * width + x]
			const cell = rowOffset + columns[x]
			area[cell] += weight
			if (value !== nodata && value > 0) {
				land[cell] += weight
				elevationSum[cell] += weight * value
			}
		}
	}
	const landFraction = new Float64Array(grid.points)
	const geopotential = new Float64Array(grid.points)
	for (let cell = 0; cell < grid.points; cell++) {
		landFraction[cell] = land[cell] / area[cell]
		geopotential[cell] = (STANDARD_GRAVITY * elevationSum[cell]) / area[cell]
	}
	return { grid, landFraction, geopotential }
}

function toSra({ grid, code, values }: GcmSraField): string {
	const header = [code, 0, 20240101, 0, grid.longitudes, grid.latitudes, 0, 0]
		.map((value) => ` ${String(value).padStart(11)}`)
		.join("")
	const lines = [header]
	for (let start = 0; start < values.length; start += SRA_VALUES_PER_LINE) {
		lines.push(
			Array.from(
				values.subarray(start, start + SRA_VALUES_PER_LINE),
				(value) => ` ${value.toFixed(3).padStart(9)}`,
			).join(""),
		)
	}
	return `${lines.join("\n")}\n`
}

export const GCM_BOUNDARY = {
	fromElevation,
	files({
		grid,
		landFraction,
		geopotential,
	}: GcmBoundary): Record<string, string> {
		const prefix = `N${String(grid.latitudes).padStart(3, "0")}_surf_`
		return {
			[`${prefix}0${LAND_SEA_CODE}.sra`]: toSra({
				grid,
				code: LAND_SEA_CODE,
				values: landFraction,
			}),
			[`${prefix}0${OROGRAPHY_CODE}.sra`]: toSra({
				grid,
				code: OROGRAPHY_CODE,
				values: geopotential,
			}),
		}
	},
}
