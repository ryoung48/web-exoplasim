import type {
	GcmFourierAnalysis,
	GcmFourierSize,
	GcmFourierTables,
} from "@/model/climate/gcm/fourier/types"
import dlambdaCode from "@/model/climate/gcm/fourier/wgsl/dlambda.wgsl?raw"
import forwardCode from "@/model/climate/gcm/fourier/wgsl/forward.wgsl?raw"
import inverseCode from "@/model/climate/gcm/fourier/wgsl/inverse.wgsl?raw"
import { KERNEL } from "@/model/climate/gcm/kernel"
import type {
	GcmKernel,
	GcmTransferRequest,
} from "@/model/climate/gcm/kernel/types"

// fftmod.f90's gp2fc keeps c_m = (1/N) sum_j g_j exp(-i m lambda_j) as
// (re, im) pairs per row; fc2gp sums c_0 + 2 Re(c_m exp(i m lambda_j)) and
// ignores Im c_0. Only m <= NTRU survives truncation, so both are dense
// products with NFC = 2 (NTRU + 1) coefficients.
function tables({ longitudes, truncation }: GcmFourierSize): GcmFourierTables {
	const coefficients = 2 * (truncation + 1)
	const forward = new Float64Array(longitudes * coefficients)
	const inverse = new Float64Array(coefficients * longitudes)
	for (let j = 0; j < longitudes; j++) {
		const lambda = (2 * Math.PI * j) / longitudes
		for (let m = 0; m <= truncation; m++) {
			const cos = Math.cos(m * lambda)
			const sin = Math.sin(m * lambda)
			forward[j * coefficients + 2 * m] = cos / longitudes
			forward[j * coefficients + 2 * m + 1] = -sin / longitudes
			const weight = m === 0 ? 1 : 2
			inverse[2 * m * longitudes + j] = weight * cos
			inverse[(2 * m + 1) * longitudes + j] = m === 0 ? 0 : -weight * sin
		}
	}
	return { forward, inverse }
}

function forward({
	context,
	source,
	target,
	planes,
}: GcmTransferRequest): Promise<GcmKernel> {
	const { latitudes, truncation } = context.state.dimensions
	return KERNEL.pipeline({
		context,
		label: `fourier forward ${source} -> ${target}`,
		code: forwardCode,
		constants: {
			THREADS: planes * latitudes * 2 * (truncation + 1),
			SOURCE: context.state.slots[source].offset,
			TARGET: context.state.slots[target].offset,
		},
	})
}

function inverse({
	context,
	source,
	target,
	planes,
}: GcmTransferRequest): Promise<GcmKernel> {
	const { latitudes, longitudes } = context.state.dimensions
	return KERNEL.pipeline({
		context,
		label: `fourier inverse ${source} -> ${target}`,
		code: inverseCode,
		constants: {
			THREADS: planes * latitudes * longitudes,
			SOURCE: context.state.slots[source].offset,
			TARGET: context.state.slots[target].offset,
		},
	})
}

function dlambda({
	context,
	source,
	target,
	planes,
}: GcmTransferRequest): Promise<GcmKernel> {
	const { latitudes, truncation } = context.state.dimensions
	return KERNEL.pipeline({
		context,
		label: `fourier d/dlambda ${source} -> ${target}`,
		code: dlambdaCode,
		constants: {
			THREADS: planes * latitudes * (truncation + 1),
			SOURCE: context.state.slots[source].offset,
			TARGET: context.state.slots[target].offset,
		},
	})
}

// gp2fc in f64 for set-up: each row's coefficients m = 0..NTRU as (re, im)
// pairs, rows of 2 (NTRU + 1).
function analyse({
	values,
	longitudes,
	truncation,
}: GcmFourierAnalysis): Float64Array {
	const { forward } = tables({ longitudes, truncation })
	const coefficients = 2 * (truncation + 1)
	const rows = values.length / longitudes
	const result = new Float64Array(rows * coefficients)
	for (let row = 0; row < rows; row++)
		for (let c = 0; c < coefficients; c++) {
			let sum = 0
			for (let j = 0; j < longitudes; j++)
				sum += values[row * longitudes + j] * forward[j * coefficients + c]
			result[row * coefficients + c] = sum
		}
	return result
}

export const FOURIER = {
	tables,
	analyse,
	forward,
	inverse,
	dlambda,
}
