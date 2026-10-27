import { KERNEL } from "@/model/climate/gcm/kernel"
import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import type { GcmTableValues } from "@/model/climate/gcm/layout/types"
import type {
	GcmDivergenceRequest,
	GcmFilteredTable,
	GcmFluxTendencyRequest,
	GcmLegendreAnalysis,
	GcmLegendreKernelTablesRequest,
	GcmLegendreRequest,
	GcmLegendreTables,
	GcmLegendreTransferRequest,
	GcmPhysicsFilterRequest,
	GcmPhysicsFilters,
	GcmTendencyRequest,
	GcmWindRequest,
} from "@/model/climate/gcm/legendre/types"
import dv2uvCode from "@/model/climate/gcm/legendre/wgsl/dv2uv.wgsl?raw"
import forwardCode from "@/model/climate/gcm/legendre/wgsl/forward.wgsl?raw"
import inverseCode from "@/model/climate/gcm/legendre/wgsl/inverse.wgsl?raw"
import qtendCode from "@/model/climate/gcm/legendre/wgsl/qtend.wgsl?raw"
import uv2dvCode from "@/model/climate/gcm/legendre/wgsl/uv2dv.wgsl?raw"

// legini in legmod.f90, in f64. Modes run m = 0..NTRU, then n = m..NTRU;
// tables are indexed [latitude * NCSP + mode] like Fortran's q(NCSP, NLAT).
function tables({ grid, truncation }: GcmLegendreRequest): GcmLegendreTables {
	const modes = ((truncation + 1) * (truncation + 2)) / 2
	const size = modes * grid.latitudes
	const result: GcmLegendreTables = {
		qi: new Float64Array(size),
		qj: new Float64Array(size),
		qc: new Float64Array(size),
		qe: new Float64Array(size),
		qm: new Float64Array(size),
		qq: new Float64Array(size),
		qu: new Float64Array(size),
		qv: new Float64Array(size),
	}
	const pli = new Float64Array(modes + 1)
	const pld = new Float64Array(modes + 1)
	for (let lat = 0; lat < grid.latitudes; lat++) {
		const sin = grid.latitudeSines[lat]
		const weight = grid.latitudeWeights[lat]
		const cosSquared = 1 - sin * sin
		const weightOverCosSquared = weight / cosSquared
		let f1m = Math.sqrt(1.5)
		pli[1] = Math.sqrt(0.5)
		pli[2] = f1m * sin
		pld[1] = 0
		let lm = 2
		for (let m = 0; m <= truncation; m++) {
			if (m > 0) {
				lm++
				const f2m = -f1m * Math.sqrt(cosSquared / (m + m))
				f1m = f2m * Math.sqrt(m + m + 3)
				pli[lm] = f2m
				if (lm < modes) {
					lm++
					pli[lm] = f1m * sin
					pld[lm - 1] = -m * f2m * sin
				}
			}
			const mSquared = m * m
			for (let n = m + 2; n <= truncation; n++) {
				lm++
				const z1 = Math.sqrt(
					((n - 1) * (n - 1) - mSquared) / (4 * (n - 1) * (n - 1) - 1),
				)
				const z2 = sin * pli[lm - 1] - z1 * pli[lm - 2]
				pli[lm] = z2 * Math.sqrt((4 * n * n - 1) / (n * n - mSquared))
				pld[lm - 1] = (1 - n) * z2 + n * z1 * pli[lm - 2]
			}
			if (lm < modes) {
				const z3 = Math.sqrt(
					(truncation * truncation - mSquared) /
						(4 * truncation * truncation - 1),
				)
				pld[lm] =
					-truncation * sin * pli[lm] +
					(truncation + truncation + 1) * pli[lm - 1] * z3
			} else {
				pld[lm] = -truncation * sin * pli[lm]
			}
		}
		let w = 0
		for (let m = 0; m <= truncation; m++) {
			for (let n = m; n <= truncation; n++) {
				const inverseDegree = n > 0 ? 1 / (n * (n + 1)) : 0
				const at = lat * modes + w
				const p = pli[w + 1]
				const d = pld[w + 1]
				result.qi[at] = p
				result.qj[at] = d
				result.qc[at] = p * weight
				result.qu[at] = p * inverseDegree * m
				result.qv[at] = d * inverseDegree
				result.qe[at] = d * weightOverCosSquared
				result.qq[at] = p * weightOverCosSquared * n * (n + 1) * 0.5
				result.qm[at] = p * weightOverCosSquared * m
				w++
			}
		}
	}
	return result
}

// The skgpsp / skspgp factors from legini, indexed by total wavenumber.
function filters({
	truncation,
	nfilter,
	ngptfilter,
	nspvfilter,
	filterkappa,
	nfilterexp,
	landhoskn0,
}: GcmPhysicsFilterRequest): GcmPhysicsFilters {
	const gridToSpectral = new Float64Array(truncation + 1)
	const spectralToGrid = new Float64Array(truncation + 1)
	for (let degree = 0; degree <= truncation; degree++) {
		const n = degree + 1
		const shapes = {
			0: 1,
			1: 1 - n / (truncation + 1),
			2: Math.exp(-filterkappa * (n / truncation) ** nfilterexp),
			3: Math.exp(-(((n * (n + 1)) / (landhoskn0 * (landhoskn0 + 1))) ** 2)),
			4: (1 - n / (truncation + 1)) ** 2,
		}
		const shape = nfilter === 0 ? 1 : shapes[nfilter]
		gridToSpectral[degree] = 1 - ngptfilter + ngptfilter * shape
		spectralToGrid[degree] = 1 - nspvfilter + nspvfilter * shape
	}
	return { gridToSpectral, spectralToGrid }
}

function filtered({
	table,
	filter,
	truncation,
}: GcmFilteredTable): Float64Array {
	const modes = ((truncation + 1) * (truncation + 2)) / 2
	const result = new Float64Array(table.length)
	for (let at = 0; at < table.length; at++) {
		let w = at % modes
		let m = 0
		while (w >= truncation + 1 - m) {
			w -= truncation + 1 - m
			m++
		}
		result[at] = table[at] * filter[m + w]
	}
	return result
}

function forward({
	context,
	source,
	target,
	planes,
	table,
}: GcmLegendreTransferRequest): Promise<GcmKernel> {
	const { truncation } = context.state.dimensions
	return KERNEL.pipeline({
		context,
		label: `legendre forward ${source} -> ${target}`,
		code: forwardCode,
		constants: {
			THREADS: (planes * (truncation + 1) * (truncation + 2)) / 2,
			SOURCE: context.state.slots[source].offset,
			TARGET: context.state.slots[target].offset,
			TABLE: context.tables.slots[table].offset,
		},
	})
}

function inverse({
	context,
	source,
	target,
	planes,
	table,
}: GcmLegendreTransferRequest): Promise<GcmKernel> {
	const { truncation, latitudes } = context.state.dimensions
	return KERNEL.pipeline({
		context,
		label: `legendre inverse ${source} -> ${target}`,
		code: inverseCode,
		constants: {
			THREADS: planes * latitudes * (truncation + 1),
			SOURCE: context.state.slots[source].offset,
			TARGET: context.state.slots[target].offset,
			TABLE: context.tables.slots[table].offset,
		},
	})
}

// The tables the kernels read, named legendre_<q>. Grid-to-spectral sums
// (qc, qe, qm, qq) carry skgpsp and spectral-to-grid sums (qi, qj, qu, qv)
// carry skspgp, as every legmod.f90 loop applies them.
function kernelTables({
	tables,
	filters,
	truncation,
}: GcmLegendreKernelTablesRequest): GcmTableValues {
	const result: GcmTableValues = {}
	for (const name of ["qc", "qe", "qm", "qq"] as const)
		result[`legendre_${name}`] = filtered({
			table: tables[name],
			filter: filters.gridToSpectral,
			truncation,
		})
	for (const name of ["qi", "qj", "qu", "qv"] as const)
		result[`legendre_${name}`] = filtered({
			table: tables[name],
			filter: filters.spectralToGrid,
			truncation,
		})
	return result
}

function modes(context: GcmKernelContext): number {
	const { truncation } = context.state.dimensions
	return ((truncation + 1) * (truncation + 2)) / 2
}

function dv2uv({
	context,
	divergence,
	vorticity,
	u,
	v,
	planes,
	plavor,
}: GcmWindRequest): Promise<GcmKernel> {
	const { truncation, latitudes } = context.state.dimensions
	const slots = context.state.slots
	return KERNEL.pipeline({
		context,
		label: `dv2uv ${divergence}, ${vorticity} -> ${u}, ${v}`,
		code: dv2uvCode,
		constants: {
			THREADS: planes * latitudes * (truncation + 1),
			DIVERGENCE: slots[divergence].offset,
			VORTICITY: slots[vorticity].offset,
			U: slots[u].offset,
			V: slots[v].offset,
			PLAVOR: plavor,
		},
	})
}

function uv2dv({
	context,
	u,
	v,
	kinetic,
	divergence,
	vorticity,
	planes,
}: GcmDivergenceRequest): Promise<GcmKernel> {
	const slots = context.state.slots
	return KERNEL.pipeline({
		context,
		label: `uv2dv ${u}, ${v}${kinetic ? `, ${kinetic}` : ""} -> ${divergence}, ${vorticity}`,
		code: uv2dvCode,
		constants: {
			THREADS: planes * modes(context),
			U: slots[u].offset,
			V: slots[v].offset,
			KINETIC: kinetic ? slots[kinetic].offset : 0,
			HAS_KINETIC: kinetic ? 1 : 0,
			DIVERGENCE: slots[divergence].offset,
			VORTICITY: slots[vorticity].offset,
		},
	})
}

function qtend({
	context,
	uFlux,
	vFlux,
	source,
	target,
	planes,
}: GcmFluxTendencyRequest): Promise<GcmKernel> {
	const slots = context.state.slots
	return KERNEL.pipeline({
		context,
		label: `qtend ${source}, ${uFlux}, ${vFlux} -> ${target}`,
		code: qtendCode,
		constants: {
			THREADS: planes * modes(context),
			U_FLUX: slots[uFlux].offset,
			V_FLUX: slots[vFlux].offset,
			SOURCE_TERM: slots[source].offset,
			TARGET: slots[target].offset,
		},
	})
}

// mktend's divergence and vorticity share uv2dv's sums plus the kinetic
// energy term; its temperature tendency is qtend's.
function mktend({
	context,
	tn,
	fu,
	fv,
	ke,
	ut,
	vt,
	d,
	t,
	z,
	planes,
}: GcmTendencyRequest): Promise<GcmKernel[]> {
	return Promise.all([
		uv2dv({
			context,
			u: fu,
			v: fv,
			kinetic: ke,
			divergence: d,
			vorticity: z,
			planes,
		}),
		qtend({ context, uFlux: ut, vFlux: vt, source: tn, target: t, planes }),
	])
}

// fc2sp's single-process branch in f64 for set-up: (m, n) sums north plus
// south rows when m + n is even, north minus south otherwise.
function analyse({
	fourier,
	qc,
	filter,
	latitudes,
	truncation,
}: GcmLegendreAnalysis): Float64Array {
	const modes = ((truncation + 1) * (truncation + 2)) / 2
	const coefficients = 2 * (truncation + 1)
	const sp = new Float64Array(2 * modes)
	for (let l = 0; l < latitudes / 2; l++) {
		const north = l * coefficients
		const south = (latitudes - 1 - l) * coefficients
		let w = 0
		for (let m = 0; m <= truncation; m++)
			for (let n = m; n <= truncation; n++) {
				const sign = (m + n) % 2 === 0 ? 1 : -1
				const weight = qc[l * modes + w]
				for (let part = 0; part < 2; part++) {
					const row =
						fourier[north + 2 * m + part] + sign * fourier[south + 2 * m + part]
					sp[2 * w + part] = sp[2 * w + part] + weight * row * filter[n]
				}
				w++
			}
	}
	return sp
}

export const LEGENDRE = {
	tables,
	filters,
	analyse,
	kernelTables,
	forward,
	inverse,
	dv2uv,
	uv2dv,
	qtend,
	mktend,
}
