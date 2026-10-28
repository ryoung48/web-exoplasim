import type { GcmSolarPosition } from "@/model/climate/gcm/calendar/solar/types"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmKernelContext } from "@/model/climate/gcm/kernel/types"

// pumamod and radmod_nl values radiation reads. nstartemp and no3 vary
// with the page's star temperature and ozone settings.
export interface GcmRadiationConstants {
	synchronous: boolean
	ga: number
	gascon: number
	acpd: number
	adv: number
	gsol0: number
	zsolar1: number
	zsolar2: number
	zsolars1: number
	zsolars2: number
	tswr1: number
	tswr2: number
	tswr3: number
	rcoeff: number
	nstartemp: boolean
	ozone: boolean
	a0o3: number
	a1o3: number
	aco3: number
	bo3: number
	co3: number
	dawnDeg: number
	sbk: number
	th2oc: number
	tpofmt: number
}

export interface GcmRadiationTablesRequest {
	grid: GcmGrid
	sigma: Float64Array
	sigmah: Float64Array
	dsigma: Float64Array
	ga: number
	acllwr: number
}

export interface GcmRadiationStepRequest {
	keplerian: boolean
	fixedSun: GcmFixedSun | null
	solar: GcmSolarPosition
	rotationSpeed: number
	toffo3: number
}

export interface GcmFixedSun {
	longitudeDeg: number
	declinationRad: number
}

export interface GcmRadiationRequest {
	context: GcmKernelContext
	constants: GcmRadiationConstants
}

export interface GcmSolarKernelRequest {
	context: GcmKernelContext
	dawnDeg: number
	synchronous: boolean
}
