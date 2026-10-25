import type {
	GcmGaussianLatitudes,
	GcmGrid,
} from "@/model/climate/gcm/grid/types"

const NEWTON_TOLERANCE = 1e-14
const grids = new Map<number, GcmGrid>()

function gaussianLatitudes(count: number): GcmGaussianLatitudes {
	const degrees = new Float64Array(count)
	const weights = new Float64Array(count)
	for (let root = 0; root < count / 2; root++) {
		let x = Math.cos((Math.PI * (root + 0.75)) / (count + 0.5))
		let derivative = 0
		for (let iteration = 0; iteration < 100; iteration++) {
			let previous = 1
			let current = x
			for (let degree = 2; degree <= count; degree++) {
				const next =
					((2 * degree - 1) * x * current - (degree - 1) * previous) / degree
				previous = current
				current = next
			}
			derivative = (count * (x * current - previous)) / (x * x - 1)
			const step = current / derivative
			x -= step
			if (Math.abs(step) < NEWTON_TOLERANCE) break
		}
		const latitude = (Math.asin(x) * 180) / Math.PI
		const weight = 2 / ((1 - x * x) * derivative * derivative)
		degrees[root] = latitude
		degrees[count - 1 - root] = -latitude
		weights[root] = weight
		weights[count - 1 - root] = weight
	}
	return { degrees, weights }
}

// PlaSim grids have twice as many longitudes as Gaussian latitudes.
function forLatitudes(latitudes: number): GcmGrid {
	const cached = grids.get(latitudes)
	if (cached) return cached
	const { degrees, weights } = gaussianLatitudes(latitudes)
	const longitudes = 2 * latitudes
	const grid: GcmGrid = {
		longitudes,
		latitudes,
		points: longitudes * latitudes,
		longitudeStepDeg: 360 / longitudes,
		latitudesDeg: degrees,
		latitudeWeights: weights,
	}
	grids.set(latitudes, grid)
	return grid
}

function forPoints(points: number): GcmGrid {
	return forLatitudes(Math.round(Math.sqrt(points / 2)))
}

export const GCM_GRID = {
	forLatitudes,
	forPoints,
	globalMean(values: Float32Array | Float64Array): number {
		const grid = forPoints(values.length)
		let total = 0
		let weight = 0
		for (let row = 0; row < grid.latitudes; row++) {
			const rowWeight = grid.latitudeWeights[row]
			for (let column = 0; column < grid.longitudes; column++) {
				total += values[row * grid.longitudes + column] * rowWeight
			}
			weight += rowWeight * grid.longitudes
		}
		return total / weight
	},
}
