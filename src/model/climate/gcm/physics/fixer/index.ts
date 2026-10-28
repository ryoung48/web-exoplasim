import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type {
	GcmFieldSpec,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"
import type {
	GcmFixerRequest,
	GcmFixerTablesRequest,
} from "@/model/climate/gcm/physics/fixer/types"
import applyCode from "@/model/climate/gcm/physics/fixer/wgsl/apply.wgsl?raw"
import columnCode from "@/model/climate/gcm/physics/fixer/wgsl/column.wgsl?raw"
import rowCode from "@/model/climate/gcm/physics/fixer/wgsl/row.wgsl?raw"
import { REDUCTION } from "@/model/climate/gcm/reduction"

// miscmod's negative-humidity fixer (nfixer = 1): borrow moisture within
// the column, then the latitude, then globally, conserving the total.
function fields(levels: number): GcmFieldSpec[] {
	return [
		{ name: "fixq", shape: "grid", count: levels },
		{ name: "fixneg", shape: "grid", count: 1 },
		{ name: "fixpos", shape: "grid", count: 1 },
		{ name: "fixsum", shape: "table", count: 2 },
	]
}

// miscini's zgw: each point's Gaussian weight.
function tables({ grid }: GcmFixerTablesRequest): GcmTableValues {
	const zgw = new Float64Array(grid.points)
	for (let lat = 0; lat < grid.latitudes; lat++)
		zgw.fill(
			grid.latitudeWeights[lat],
			lat * grid.longitudes,
			(lat + 1) * grid.longitudes,
		)
	return { zgw }
}

function kernels({
	context,
	delt2,
	psurf,
}: GcmFixerRequest): Promise<GcmKernel[]> {
	const { latitudes, longitudes } = context.state.dimensions
	const points = latitudes * longitudes
	return Promise.all([
		KERNEL.pipeline({
			context,
			label: "fixer column",
			code: columnCode,
			constants: { THREADS: points },
		}),
		KERNEL.pipeline({
			context,
			label: "fixer row",
			code: rowCode,
			constants: { THREADS: latitudes },
		}),
		REDUCTION.sum({
			context,
			label: "fixer global",
			first: "fixneg",
			second: "fixpos",
			target: "fixsum",
		}),
		KERNEL.pipeline({
			context,
			label: "fixer apply",
			code: applyCode,
			constants: { THREADS: points, DELT2: delt2, PSURF: psurf },
		}),
	])
}

export const FIXER = {
	fields,
	tables,
	kernels,
}
