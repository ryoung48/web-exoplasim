import type { GcmTargetState } from "@/model/climate/gcm/targeting/types"
import type { UnitSystem } from "@/ui/genesis/shared/ui-format"

export interface GcmTargetViewRequest {
	state: GcmTargetState
	targetK: number
	unitSystem: UnitSystem
}
