import type { GcmPumamod } from "@/model/climate/gcm/setup/pumamod/types"
import type {
	GcmStepCalendar,
	GcmStepperConstants,
	GcmStepperTablesRequest,
} from "@/model/climate/gcm/stepper/types"

// Everything the GPU model takes from set-up apart from the initial state:
// the kernels' constants, the per-step calendar, the constant tables'
// inputs except DYNAMICS.TABLES, and pumamod's CO2.
export interface GcmSetup {
	pumamod: GcmPumamod
	stepper: GcmStepperConstants
	calendar: GcmStepCalendar
	tables: Omit<GcmStepperTablesRequest, "dynamics">
	co2: number
}

// The page's model inputs, as the Fortran reads them: each namelist file's
// text by file name (plasim_namelist, planet_namelist, …).
export interface GcmSetupRequest {
	truncation: number
	levels: number
	namelists: Record<string, string>
}

// The namelists plus so(1), the initial orography's mean spectral
// coefficient, which prolog uses to lower psurf to the mean surface
// pressure, and the start-up steps still to run (0 in the main loop).
export interface GcmSetupConstantsRequest extends GcmSetupRequest {
	meanOrography: number
	kits: number
}

export interface GcmTimestepRequest {
	pumamod: GcmPumamod
	kits: number
}

export interface GcmTimesteps {
	deltsec: number
	delt: number
}

export interface GcmScheduleRequest {
	request: GcmSetupRequest
	state: GcmInitialState
}

// One phase of master's run: the start-up step with `kits` still to run
// (0 for the main loop), its kernel constants and makebm's bm1.
export interface GcmSchedulePhase {
	kits: number
	stepper: GcmStepperConstants
	bm1: Float64Array
}

export interface GcmSchedule {
	tables: GcmStepperTablesRequest
	startup: GcmSchedulePhase[]
	main: GcmSchedulePhase
	calendar: GcmStepCalendar
	startStep: number
}

export interface GcmDynamicsTablesSetup {
	request: GcmSetupRequest
	kits: number
	state: GcmInitialState
}

// The namelists plus system_clock's count, which seeds the initial noise
// when the namelist's seed is zero.
export interface GcmSetupStateRequest extends GcmSetupRequest {
	clock: number
}

// The model state after prolog under STEPPER's field names, and the
// spectral orography (DYNAMICS.TABLES' sop; srp is the state's sr).
export interface GcmInitialState {
	fields: Record<string, Float64Array>
	so: Float64Array
}
