import type { GcmOrbit } from "@/model/climate/gcm/calendar/types"
import type { GcmDynamicsConstants } from "@/model/climate/gcm/dynamics/types"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import type { GcmDimensions } from "@/model/climate/gcm/layout/types"
import type { GcmPhysicsFilterRequest } from "@/model/climate/gcm/legendre/types"
import type { GcmCarbonConstants } from "@/model/climate/gcm/physics/carbon/types"
import type { GcmFixerRequest } from "@/model/climate/gcm/physics/fixer/types"
import type { GcmPrecipitationConstants } from "@/model/climate/gcm/physics/precipitation/types"
import type { GcmRadiationConstants } from "@/model/climate/gcm/physics/radiation/types"
import type { GcmSurfaceConstants } from "@/model/climate/gcm/physics/surface/types"
import type { GcmSurfaceFluxConstants } from "@/model/climate/gcm/physics/surface-flux/types"

// Every constant table a step reads. dynamics holds DYNAMICS.TABLES'
// values (set-up port and dump); the rest are the physics modules' inputs.
export interface GcmStepperTablesRequest {
	filters: GcmPhysicsFilterRequest
	dynamics: Record<string, ArrayLike<number>>
	akap: number
	gascon: number
	ga: number
	vdiffLamm: number
	vdiffD: number
	acllwr: number
	rcritmod: number
	rcritslope: number
	dsoilz: ArrayLike<number>
}

export interface GcmStepperContextRequest {
	device: GPUDevice
	dimensions: GcmDimensions
	tables: GcmStepperTablesRequest
}

export interface GcmStepperTablesBuild {
	grid: GcmGrid
	truncation: number
	request: GcmStepperTablesRequest
}

export interface GcmStepperConstants {
	dynamics: GcmDynamicsConstants
	fixer: Omit<GcmFixerRequest, "context">
	surfaceFlux: GcmSurfaceFluxConstants
	radiation: GcmRadiationConstants
	precipitation: GcmPrecipitationConstants
	surface: GcmSurfaceConstants
	carbon: GcmCarbonConstants
}

export interface GcmStepperRequest {
	context: GcmKernelContext
	constants: GcmStepperConstants
}

export interface GcmStepperEncode {
	pass: GPUComputePassEncoder
	context: GcmKernelContext
	kernels: GcmKernel[]
}

// Time-only inputs of the per-step parameters: pumamod's calendar values,
// radmod's rotation and ozone phase, and the fixed orbit.
export interface GcmStepCalendar {
	stepsPerYear: number
	stepsPerDay: number
	stepMinutes: number
	daysPerYear: number
	daysPerMonth: number
	solarDay: number
	rotationSpeed: number
	toffo3: number
	orbit: GcmOrbit
	carbonInterval: number
}

export interface GcmStepValuesRequest {
	step: number
	carbonStep: number
	calendar: GcmStepCalendar
}

// The step-parameter fields for one model step, by state field name, and
// carbonmod's counter after it.
export interface GcmStepValues {
	fields: Record<string, Float64Array>
	carbonStep: number
}

// The batch size in publish intervals and the GPU time estimate per
// interval (ms) it came from.
export interface GcmBatchPace {
	intervals: number
	estimate: number
}

// The last batch's pace and its measured GPU time (ms).
export interface GcmBatchSizing {
	pace: GcmBatchPace
	milliseconds: number
}

// Steps' CPU values in order (STEPPER.values' fields); `params` holds them
// on the GPU and `staging` receives one snapshot per publish interval.
export interface GcmBatchRequest {
	context: GcmKernelContext
	kernels: GcmKernel[]
	pack: GcmKernel
	params: GPUBuffer
	steps: Array<Record<string, Float64Array>>
	firstStep: number
	publishEvery: number
	staging: GPUBuffer
	// GPU timestamps for the batch, or null without timestamp-query.
	timing: GcmBatchTiming | null
}

// A two-entry timestamp query set and its resolve buffer, reused by every
// batch: the copy into `staging` is ordered after each batch's resolve.
export interface GcmBatchTiming {
	querySet: GPUQuerySet
	resolve: GPUBuffer
}
