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
// coefficient, which prolog uses to lower psurf to the mean surface pressure.
export interface GcmSetupConstantsRequest extends GcmSetupRequest {
	meanOrography: number
}
