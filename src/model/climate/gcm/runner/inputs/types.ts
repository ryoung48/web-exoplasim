import type { GcmNamelistEdits } from "@/model/climate/gcm/namelist/types"

export interface GcmSurfaceFileRequest {
	name: string
	keepSurfaceFiles: boolean
	namelistEdits: GcmNamelistEdits
}
