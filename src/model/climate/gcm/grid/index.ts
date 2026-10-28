import type {
	GcmGaussianLatitudes,
	GcmGrid,
	GcmLegendrePoint,
} from "@/model/climate/gcm/grid/types"

// gaussmod.f90's inigau: Newton steps on the normalised Legendre
// polynomial's trigonometric series, to 1e-16 or 50 steps.
const INIGAU_PI = 3.14159265358979
const INIGAU_TOLERANCE = 1e-16
const INIGAU_ITERATIONS = 50
const grids = new Map<number, GcmGrid>()

// ql: the normalised Legendre polynomial of degree k at p.
function legendre({ degree: k, at: p }: GcmLegendrePoint): number {
	const angle = Math.acos(p)
	let factor = 1
	let sum = 0
	let term = 0
	for (let j = k; j >= 0; j -= 2) {
		term = factor * Math.cos(angle * j)
		sum = sum + term
		const z4 = (k - j + 1) * (k + j) * 0.5
		factor = (factor * z4) / (z4 + (j - 1))
	}
	if (k % 2 === 0) sum = sum - 0.5 * term
	let norm = Math.sqrt(2)
	for (let j = 1; j <= k; j++) norm = norm * Math.sqrt(1 - 0.25 / (j * j))
	return norm * sum
}

function gaussianLatitudes(count: number): GcmGaussianLatitudes {
	const degrees = new Float64Array(count)
	const sines = new Float64Array(count)
	const weights = new Float64Array(count)
	const z0 = INIGAU_PI / (2 * count + 1)
	const z1 = 1 / (count * count * 8)
	const z4 = 2 / (count * count)
	for (let root = 0; root < count / 2; root++) {
		const guess = z0 * (2 * (root + 1) - 0.5)
		let x = Math.cos(guess + z1 / Math.tan(guess))
		for (let iteration = 0; iteration < INIGAU_ITERATIONS; iteration++) {
			const value = legendre({ degree: count, at: x })
			const z =
				x * value -
				Math.sqrt((count + count + 1) / (count + count - 1)) *
					legendre({ degree: count - 1, at: x })
			const step = value * ((x * x - 1) / (count * z))
			x = x - step
			if (Math.abs(step) < INIGAU_TOLERANCE) break
		}
		const z5 = legendre({ degree: count - 1, at: x }) / Math.sqrt(count - 0.5)
		const latitude = (Math.asin(x) * 180) / Math.PI
		const weight = (z4 * (1 - x * x)) / (z5 * z5)
		degrees[root] = latitude
		degrees[count - 1 - root] = -latitude
		sines[root] = x
		sines[count - 1 - root] = -x
		weights[root] = weight
		weights[count - 1 - root] = weight
	}
	return { degrees, sines, weights }
}

// PlaSim grids have twice as many longitudes as Gaussian latitudes.
function forLatitudes(latitudes: number): GcmGrid {
	const cached = grids.get(latitudes)
	if (cached) return cached
	const { degrees, sines, weights } = gaussianLatitudes(latitudes)
	const longitudes = 2 * latitudes
	const grid: GcmGrid = {
		longitudes,
		latitudes,
		points: longitudes * latitudes,
		longitudeStepDeg: 360 / longitudes,
		latitudesDeg: degrees,
		latitudeSines: sines,
		latitudeWeights: weights,
	}
	grids.set(latitudes, grid)
	return grid
}

function forPoints(points: number): GcmGrid {
	return forLatitudes(Math.round(Math.sqrt(points / 2)))
}

function forTruncation(truncation: number): GcmGrid {
	const latitudes: Record<number, number> = { 21: 32, 42: 64, 63: 96 }
	const count = latitudes[truncation]
	if (count === undefined) throw new Error(`T${truncation} is not built`)
	return forLatitudes(count)
}

export const GCM_GRID = {
	forLatitudes,
	forPoints,
	forTruncation,
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
