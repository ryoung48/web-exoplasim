import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import type {
	GcmDimensions,
	GcmFieldShape,
} from "@/model/climate/gcm/layout/types"

// pumamod scalars the dynamics reads (set by initpm and the timestep).
export interface GcmDynamicsConstants {
	psurf: number
	ww: number
	cv: number
	ct: number
	akap: number
	rdbrv: number
	adv: number
	acpd: number
	ga: number
	plavor: number
	delt: number
	delt2: number
	deltsec2: number
	pnu: number
	pnu21: number
	// False during the nkits start-up steps, which skip the leapfrog filter.
	filter: boolean
}

export interface GcmDynamicsRequest {
	context: GcmKernelContext
	constants: GcmDynamicsConstants
}

export interface GcmDynamicsKernels {
	gridpointa: GcmKernel[]
	spectrala: GcmKernel[]
	spectrald: GcmKernel[]
	physicsIn: GcmKernel[]
	physicsOut: GcmKernel[]
}

export interface GcmDynamicsTable {
	name: string
	count: (dimensions: GcmDimensions) => number
}

export interface GcmFieldGroup {
	names: string[]
	shape: GcmFieldShape
	count: number
}

export interface GcmDynamicsPipeline {
	label: string
	code: string
	values: Record<string, number>
}

export interface GcmDynamicsTransfer {
	source: string
	target: string
}

export interface GcmDynamicsWinds {
	divergence: string
	vorticity: string
	u: string
	v: string
}
