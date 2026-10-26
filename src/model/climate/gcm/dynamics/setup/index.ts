import type {
	GcmDynamicsSetup,
	GcmDynamicsSetupInput,
	GcmDynamicsTablesRequest,
	GcmLatitudeFactorsRequest,
	GcmMatrixInverse,
	GcmSemiImplicitInit,
	GcmSemiImplicitRequest,
	GcmTimeScales,
} from "@/model/climate/gcm/dynamics/setup/types"
import type { GcmTableValues } from "@/model/climate/gcm/layout/types"

// pumamod's PI parameter, which TWOPI and every time scale use.
const PI = 3.14159265359
const TWOPI = PI + PI

// dayseccheck: values under one timestep are taken as days.
function seconds({ values, threshold, day }: GcmTimeScales): number[] {
	const largest = Math.max(...values)
	return largest < threshold && largest > 0
		? values.map((value) => value * day)
		: [...values]
}

// initpm in plasim.f90 for NEQSIG = 0, the only spacing the page uses.
function initpm(input: GcmDynamicsSetupInput): GcmDynamicsSetup {
	const { levels, truncation, nhdiff, dayLengthS, ct } = input
	if (input.neqsig !== 0)
		throw new Error(`NEQSIG ${input.neqsig} is not ported`)
	const sigmah = Float64Array.from({ length: levels }, (_, l) => {
		const z = (l + 1) / levels
		return 0.75 * z + 1.75 * z ** 3 - 1.5 * z ** 4
	})
	const dsigma = sigmah.map((value, l) =>
		l === 0 ? value : value - sigmah[l - 1],
	)
	const rdsig = dsigma.map((value) => 0.5 / value)
	const sigma = sigmah.map((value, l) =>
		l === 0 ? 0.5 * value : 0.5 * (sigmah[l - 1] + value),
	)
	const threshold = dayLengthS / input.stepsPerDay
	const rate = (values: ReadonlyArray<number>) =>
		Float64Array.from(
			seconds({ values, threshold, day: dayLengthS }),
			(value) => (value > 0 ? dayLengthS / (TWOPI * value) : 0),
		)
	const coefficients = (truncation + 1) * (truncation + 2)
	const sak = new Float64Array(coefficients * levels)
	for (let l = 0; l < levels; l++) {
		const power = input.ndel[l]
		const scale = 1 / (truncation - nhdiff) ** power
		let r = 0
		for (let m = 0; m <= truncation; m++)
			for (let n = m; n <= truncation; n++) {
				const value = n >= nhdiff ? scale * (n - nhdiff) ** power : 0
				sak[l * coefficients + r] = value
				sak[l * coefficients + r + 1] = value
				r += 2
			}
	}
	const nindex = new Float64Array(coefficients)
	const spnorm = new Float64Array(coefficients)
	let r = 0
	let norm = 1 / Math.sqrt(2)
	for (let m = 0; m <= truncation; m++) {
		for (let n = m; n <= truncation; n++) {
			nindex[r] = nindex[r + 1] = n
			spnorm[r] = spnorm[r + 1] = norm
			r += 2
		}
		norm = -norm
	}
	const setup: GcmDynamicsSetup = {
		sigmah,
		sigma,
		dsigma,
		rdsig,
		damp: rate(input.restim),
		tfrc: rate(input.tfrc),
		tdissd: rate(input.tdissd),
		tdissz: rate(input.tdissz),
		tdisst: rate(input.tdisst),
		tdissq: rate(input.tdissq),
		sak,
		nindex,
		spnorm,
		t0: Float64Array.from(input.t0, (value) => value / ct),
		dtns: input.dtns / ct,
		dtep: input.dtep / ct,
		dttrp: input.dttrp / ct,
		tkp: new Float64Array(levels),
		t01s2: new Float64Array(levels),
		g: new Float64Array(levels * levels),
		c: new Float64Array(levels * levels),
		tau: new Float64Array(levels * levels),
	}
	initsi({ setup, akap: input.akap })
	return setup
}

// initsi: the semi-implicit matrices of the ECMWF vertical scheme
// (Simmons and Burridge 1981). Matrices are column-major, a(i, j) at
// j * NLEV + i.
function initsi({ setup, akap }: GcmSemiImplicitInit): void {
	const { t0, sigmah, dsigma, rdsig, tkp, t01s2, g, c, tau } = setup
	const n = t0.length
	const at = (i: number, j: number) => j * n + i
	for (let l = 0; l < n; l++) tkp[l] = akap * t0[l]
	for (let l = 0; l < n - 1; l++) t01s2[l] = t0[l + 1] - t0[l]
	t01s2[n - 1] = 0
	const alp = Float64Array.from({ length: n }, (_, l) =>
		l === 0 ? 0 : Math.log(sigmah[l]) - Math.log(sigmah[l - 1]),
	)
	g[at(0, 0)] = 1
	for (let l = 1; l < n; l++) {
		g[at(l, l)] = 1 - (alp[l] * sigmah[l - 1]) / dsigma[l]
		for (let k = 0; k < l; k++) g[at(l, k)] = alp[l]
	}
	for (let l = 0; l < n; l++)
		for (let k = 0; k < n; k++)
			c[at(l, k)] = g[at(k, l)] * (dsigma[l] / dsigma[k])
	let t01 = t01s2[0]
	let sig = sigmah[0]
	tau[at(0, 0)] = 0.5 * t01 * (sig - 1) + tkp[0]
	for (let k = 1; k < n; k++) tau[at(k, 0)] = 0.5 * t01 * dsigma[k]
	for (let l = 1; l < n; l++) {
		const previousT01 = t01
		const previousSig = sig
		t01 = t01s2[l]
		sig = sigmah[l]
		for (let k = 0; k < n; k++) {
			const below = k <= l ? 1 : 0
			const above = k < l ? 1 : 0
			let value = previousT01 * (previousSig - above)
			if (l < n - 1) value = value + t01 * (sig - below)
			value = value * rdsig[l] * dsigma[k]
			if (k <= l) value = value + tkp[l] * c[at(k, l)]
			tau[at(k, l)] = value
		}
	}
}

// ludcmp and lubksb from plasim.f90 (Numerical Recipes, partial pivoting),
// so minvers reproduces Fortran's inverse.
function invert({ matrix, size: n }: GcmMatrixInverse): void {
	const a = matrix
	const at = (i: number, j: number) => j * n + i
	const scale = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let largest = 0
		for (let j = 0; j < n; j++)
			largest = Math.max(largest, Math.abs(a[at(i, j)]))
		scale[i] = 1 / largest
	}
	const index = new Int32Array(n)
	for (let j = 0; j < n; j++) {
		for (let i = 1; i < j; i++) {
			let dot = 0
			for (let k = 0; k < i; k++) dot += a[at(i, k)] * a[at(k, j)]
			a[at(i, j)] -= dot
		}
		let largest = 0
		let pivot = j
		for (let i = j; i < n; i++) {
			if (j > 0) {
				let dot = 0
				for (let k = 0; k < j; k++) dot += a[at(i, k)] * a[at(k, j)]
				a[at(i, j)] -= dot
			}
			const size = scale[i] * Math.abs(a[at(i, j)])
			if (size >= largest) {
				pivot = i
				largest = size
			}
		}
		if (j !== pivot) {
			for (let k = 0; k < n; k++) {
				const swap = a[at(pivot, k)]
				a[at(pivot, k)] = a[at(j, k)]
				a[at(j, k)] = swap
			}
			scale[pivot] = scale[j]
		}
		index[j] = pivot
		if (a[at(j, j)] === 0) a[at(j, j)] = Number.MIN_VALUE
		for (let i = j + 1; i < n; i++) a[at(i, j)] /= a[at(j, j)]
	}
	const inverse = new Float64Array(n * n)
	for (let column = 0; column < n; column++) {
		const b = Float64Array.from({ length: n }, (_, i) => (i === column ? 1 : 0))
		let first = -1
		for (let i = 0; i < n; i++) {
			const l = index[i]
			let sum = b[l]
			b[l] = b[i]
			if (first >= 0) {
				for (let j = first; j < i; j++) sum -= a[at(i, j)] * b[j]
			} else if (sum !== 0) {
				first = i
			}
			b[i] = sum
		}
		for (let i = n - 1; i >= 0; i--) {
			let sum = b[i]
			for (let j = i + 1; j < n; j++) sum -= a[at(i, j)] * b[j]
			b[i] = sum / a[at(i, i)]
		}
		inverse.set(b, column * n)
	}
	matrix.set(inverse)
}

// makebm: bm1(:, :, n) = inverse of (1 / (n (n + 1)) I + delt^2 B), laid
// out like Fortran's bm1(NLEV, NLEV, NTRU).
function makebm({
	setup,
	truncation,
	delt,
}: GcmSemiImplicitRequest): Float64Array {
	const { t0, dsigma, g, tau } = setup
	const n = t0.length
	const deltSquared = delt * delt
	const base = new Float64Array(n * n)
	for (let l1 = 0; l1 < n; l1++)
		for (let l2 = 0; l2 < n; l2++) {
			let dot = 0
			for (let k = 0; k < n; k++) dot += g[l1 * n + k] * tau[k * n + l2]
			base[l1 * n + l2] = deltSquared * (t0[l1] * dsigma[l2] + dot)
		}
	const bm1 = new Float64Array(n * n * truncation)
	for (let degree = 1; degree <= truncation; degree++) {
		const matrix = base.slice()
		for (let l = 0; l < n; l++) matrix[l * n + l] += 1 / (degree * (degree + 1))
		invert({ matrix, size: n })
		bm1.set(matrix, (degree - 1) * n * n)
	}
	return bm1
}

// prolog's rcsq: 1 / cos^2(latitude) at every grid point.
function latitudeFactors({ grid }: GcmLatitudeFactorsRequest): Float64Array {
	const rcsq = new Float64Array(grid.points)
	for (let lat = 0; lat < grid.latitudes; lat++) {
		const sin = grid.latitudeSines[lat]
		rcsq.fill(
			1 / (1 - sin * sin),
			lat * grid.longitudes,
			(lat + 1) * grid.longitudes,
		)
	}
	return rcsq
}

// DYNAMICS.TABLES values these routines provide; sop (orography) and srp
// (restoration temperature) come from the surface and restoration set-up.
function tables({
	setup,
	bm1,
	rcsq,
}: GcmDynamicsTablesRequest): GcmTableValues {
	return {
		t0: setup.t0,
		dsigma: setup.dsigma,
		sigmah: setup.sigmah,
		rdsig: setup.rdsig,
		t01s2: setup.t01s2,
		tkp: setup.tkp,
		damp: setup.damp,
		tdisst: setup.tdisst,
		tdissq: setup.tdissq,
		tdissd: setup.tdissd,
		tdissz: setup.tdissz,
		tfrc: setup.tfrc,
		c: setup.c,
		g: setup.g,
		tau: setup.tau,
		bm1,
		rcsq,
		nindex: setup.nindex,
		sakpp: setup.sak,
	}
}

export const DYNAMICS_SETUP = {
	initpm,
	makebm,
	latitudeFactors,
	tables,
}
