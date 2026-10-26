import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type {
	GcmKernelContext,
	GcmTransferRequest,
} from "@/model/climate/gcm/kernel/types"

export interface GcmLegendreRequest {
	grid: GcmGrid
	truncation: number
}

export interface GcmLegendreTables {
	qi: Float64Array
	qj: Float64Array
	qc: Float64Array
	qe: Float64Array
	qm: Float64Array
	qq: Float64Array
	qu: Float64Array
	qv: Float64Array
}

export type GcmPhysicsFilterKind = 0 | 1 | 2 | 3 | 4

export interface GcmPhysicsFilterRequest {
	truncation: number
	nfilter: GcmPhysicsFilterKind
	ngptfilter: number
	nspvfilter: number
	filterkappa: number
	nfilterexp: number
	landhoskn0: number
}

export interface GcmPhysicsFilters {
	gridToSpectral: Float64Array
	spectralToGrid: Float64Array
}

export interface GcmFilteredTable {
	table: Float64Array
	filter: Float64Array
	truncation: number
}

export interface GcmLegendreKernelTablesRequest {
	tables: GcmLegendreTables
	filters: GcmPhysicsFilters
	truncation: number
}

export interface GcmLegendreTransferRequest extends GcmTransferRequest {
	table: string
}

export interface GcmWindRequest {
	context: GcmKernelContext
	divergence: string
	vorticity: string
	u: string
	v: string
	planes: number
	plavor: number
}

export interface GcmDivergenceRequest {
	context: GcmKernelContext
	u: string
	v: string
	// Kinetic energy term of mktend's divergence; null for uv2dv.
	kinetic: string | null
	divergence: string
	vorticity: string
	planes: number
}

export interface GcmFluxTendencyRequest {
	context: GcmKernelContext
	uFlux: string
	vFlux: string
	source: string
	target: string
	planes: number
}

export interface GcmTendencyRequest {
	context: GcmKernelContext
	tn: string
	fu: string
	fv: string
	ke: string
	ut: string
	vt: string
	d: string
	t: string
	z: string
	planes: number
}
