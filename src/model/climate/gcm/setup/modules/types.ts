import type { GcmBandAlbedo } from "@/model/climate/gcm/physics/radiation/spectrum/types"
import type { GcmPumamod } from "@/model/climate/gcm/setup/pumamod/types"
import type { GcmSetupRequest } from "@/model/climate/gcm/setup/types"

export interface GcmModuleSetupRequest {
	request: GcmSetupRequest
	pumamod: GcmPumamod
}

export interface GcmAlbedoSetupRequest extends GcmModuleSetupRequest {
	albedos: GcmBandAlbedos
}

// pumamod's band albedos after solarini (or their defaults without a star
// temperature) and the namelists that may override them.
export interface GcmBandAlbedos {
	dsnowalb: GcmBandAlbedo
	dsnowalbmn: GcmBandAlbedo
	dsnowalbmx: GcmBandAlbedo
	dicealbmn: GcmBandAlbedo
	dicealbmx: GcmBandAlbedo
	dglacalbmn: GcmBandAlbedo
	dgroundalb: GcmBandAlbedo
	doceanalb: GcmBandAlbedo
}
