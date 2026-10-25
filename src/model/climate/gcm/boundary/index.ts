import type {
	GcmBoundary,
	GcmBoundaryRequest,
	GcmSraField,
} from "@/model/climate/gcm/boundary/types"
import { GCM_TERRAIN_REGRID } from "@/model/climate/gcm/terrain/regrid"

const STANDARD_GRAVITY = 9.80665
const LAND_SEA_CODE = 172
const OROGRAPHY_CODE = 129
const SRA_VALUES_PER_LINE = 8

function fromTerrain({ grid, terrain }: GcmBoundaryRequest): GcmBoundary {
	const landFraction = new Float64Array(grid.points)
	const geopotential = new Float64Array(grid.points)
	for (let row = 0; row < grid.latitudes; row++) {
		const north =
			row === 0 ? 90 : (grid.latitudesDeg[row - 1] + grid.latitudesDeg[row]) / 2
		const south =
			row === grid.latitudes - 1
				? -90
				: (grid.latitudesDeg[row] + grid.latitudesDeg[row + 1]) / 2
		for (let column = 0; column < grid.longitudes; column++) {
			const center = column * grid.longitudeStepDeg
			const mean = GCM_TERRAIN_REGRID.cell({
				terrain,
				north,
				south,
				west: center - grid.longitudeStepDeg / 2,
				east: center + grid.longitudeStepDeg / 2,
			})
			const index = row * grid.longitudes + column
			landFraction[index] = mean.landFraction
			geopotential[index] = STANDARD_GRAVITY * mean.elevationM
		}
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
	fromTerrain,
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
