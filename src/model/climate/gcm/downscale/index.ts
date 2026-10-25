import { KOPPEN } from "@/model/climate/classification/koppen"
import { GCM_BOUNDARY } from "@/model/climate/gcm/boundary"
import type {
	GcmDownscaleField,
	GcmDownscaleGrid,
	GcmDownscaleKoppen,
	GcmDownscaleRequest,
	GcmLapseRequest,
} from "@/model/climate/gcm/downscale/types"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import { GCM_TERRAIN_REGRID } from "@/model/climate/gcm/terrain/regrid"

// Interpolation plus local lapse-rate correction after koppenpasta
// (worldbuildingpasta, "An Apple Pie from Scratch, Part VI"): each model
// cell's lapse rate is the regression of temperature on elevation over the
// cell and its 8 neighbours when they span at least 100 m, otherwise the
// standard atmosphere's 6.5 K/km. Fitted rates are clamped between
// isothermal and the dry adiabat so noise cannot invert terrain.
const STANDARD_GRAVITY = 9.80665
const STANDARD_LAPSE_K_PER_M = 0.0065
const DRY_ADIABATIC_LAPSE_K_PER_M = 0.0098
const MINIMUM_ELEVATION_SPAN_M = 100
const MONTHS_PER_YEAR = 12
const DAYS_PER_MONTH = 30
const LAND_FRACTION_THRESHOLD = 0.5
const CORNERS = 4

function create({
	grid,
	terrain,
	factor,
}: GcmDownscaleRequest): GcmDownscaleGrid {
	const height = Math.ceil(terrain.height / factor)
	const width = height * 2
	const points = width * height
	const elevationM = new Float32Array(points)
	const land = new Uint8Array(points)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const mean = GCM_TERRAIN_REGRID.cell({
				terrain,
				north: 90 - (y * 180) / height,
				south: 90 - ((y + 1) * 180) / height,
				west: -180 + (x * 360) / width,
				east: -180 + ((x + 1) * 360) / width,
			})
			elevationM[y * width + x] = mean.elevationM
			land[y * width + x] = mean.landFraction >= LAND_FRACTION_THRESHOLD ? 1 : 0
		}
	}
	const corners = new Int32Array(points * CORNERS)
	const weights = new Float32Array(points * CORNERS)
	const latitudes = grid.latitudesDeg
	for (let y = 0; y < height; y++) {
		const latitude = 90 - ((y + 0.5) / height) * 180
		const last = grid.latitudes - 1
		let north = 0
		while (north < last && latitudes[north + 1] > latitude) north++
		const south = latitude >= latitudes[0] || north === last ? north : north + 1
		const s =
			south === north
				? 0
				: (latitudes[north] - latitude) / (latitudes[north] - latitudes[south])
		for (let x = 0; x < width; x++) {
			const longitude = (((x + 0.5) / width) * 360 + 180) % 360
			const column = longitude / grid.longitudeStepDeg
			const west = Math.floor(column) % grid.longitudes
			const east = (west + 1) % grid.longitudes
			const t = column - Math.floor(column)
			const base = (y * width + x) * CORNERS
			corners[base] = north * grid.longitudes + west
			corners[base + 1] = north * grid.longitudes + east
			corners[base + 2] = south * grid.longitudes + west
			corners[base + 3] = south * grid.longitudes + east
			weights[base] = (1 - s) * (1 - t)
			weights[base + 1] = (1 - s) * t
			weights[base + 2] = s * (1 - t)
			weights[base + 3] = s * t
		}
	}
	const boundary = GCM_BOUNDARY.fromTerrain({ grid, terrain })
	const cellElevationM = Float32Array.from(
		boundary.geopotential,
		(value) => value / STANDARD_GRAVITY,
	)
	const downscale: GcmDownscaleGrid = {
		grid,
		width,
		height,
		elevationM,
		land,
		modelElevationM: new Float32Array(points),
		cellElevationM,
		corners,
		weights,
	}
	return {
		...downscale,
		modelElevationM: interpolate({ downscale, values: cellElevationM }),
	}
}

function interpolate({ downscale, values }: GcmDownscaleField): Float32Array {
	const { corners, weights } = downscale
	const result = new Float32Array(downscale.width * downscale.height)
	for (let point = 0; point < result.length; point++) {
		const base = point * CORNERS
		result[point] =
			values[corners[base]] * weights[base] +
			values[corners[base + 1]] * weights[base + 1] +
			values[corners[base + 2]] * weights[base + 2] +
			values[corners[base + 3]] * weights[base + 3]
	}
	return result
}

function lapseRates({ downscale, temperature }: GcmLapseRequest): Float32Array {
	const { grid, cellElevationM } = downscale
	const rates = new Float32Array(grid.points)
	for (let row = 0; row < grid.latitudes; row++) {
		for (let column = 0; column < grid.longitudes; column++) {
			let count = 0
			let zSum = 0
			let tSum = 0
			let zzSum = 0
			let ztSum = 0
			let zMin = Number.POSITIVE_INFINITY
			let zMax = Number.NEGATIVE_INFINITY
			for (let dy = -1; dy <= 1; dy++) {
				const neighbourRow = row + dy
				if (neighbourRow < 0 || neighbourRow >= grid.latitudes) continue
				for (let dx = -1; dx <= 1; dx++) {
					const cell =
						neighbourRow * grid.longitudes +
						((column + dx + grid.longitudes) % grid.longitudes)
					const z = cellElevationM[cell]
					const t = temperature[cell]
					count++
					zSum += z
					tSum += t
					zzSum += z * z
					ztSum += z * t
					zMin = Math.min(zMin, z)
					zMax = Math.max(zMax, z)
				}
			}
			const variance = zzSum - (zSum * zSum) / count
			const rate =
				zMax - zMin >= MINIMUM_ELEVATION_SPAN_M
					? -(ztSum - (zSum * tSum) / count) / variance
					: STANDARD_LAPSE_K_PER_M
			rates[row * grid.longitudes + column] = Math.min(
				DRY_ADIABATIC_LAPSE_K_PER_M,
				Math.max(0, rate),
			)
		}
	}
	return rates
}

function temperature({ downscale, values }: GcmDownscaleField): Float32Array {
	const smooth = interpolate({ downscale, values })
	const rates = interpolate({
		downscale,
		values: lapseRates({ downscale, temperature: values }),
	})
	const { elevationM, modelElevationM } = downscale
	return smooth.map(
		(value, point) =>
			value - rates[point] * (elevationM[point] - modelElevationM[point]),
	)
}

function koppen({ downscale, months }: GcmDownscaleKoppen): Uint8Array | null {
	if (months.length < MONTHS_PER_YEAR) return null
	const ordered = months.toSorted((a, b) => a.month - b.month)
	const points = downscale.width * downscale.height
	const temperatureMonthly = new Float32Array(MONTHS_PER_YEAR * points)
	const rainfallMonthly = new Float32Array(MONTHS_PER_YEAR * points)
	ordered.forEach(({ snapshot }, month) => {
		temperatureMonthly.set(
			temperature({
				downscale,
				values: GCM_FIELDS.values({ snapshot, mode: "airTemperature" }),
			}),
			month * points,
		)
		rainfallMonthly.set(
			interpolate({
				downscale,
				values: GCM_FIELDS.values({ snapshot, mode: "precipitation" }),
			}).map((millimetersPerDay) => millimetersPerDay * DAYS_PER_MONTH),
			month * points,
		)
	})
	const classes = new Uint8Array(points)
	KOPPEN.koppenCells({
		start: 0,
		end: points,
		isLand: downscale.land,
		temperatureMonthly,
		rainfallMonthly,
		classes,
	})
	return classes
}

export const GCM_DOWNSCALE = {
	create,
	interpolate,
	temperature,
	koppen,
}
