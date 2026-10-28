import type { GcmSurfaceFileRequest } from "@/model/climate/gcm/runner/inputs/types"

const INITIAL_ICE_FILES = ["0174.sra", "1740.sra", "0210.sra", "0232.sra"]

function keepSurfaceFile({
	name,
	keepSurfaceFiles,
	namelistEdits,
}: GcmSurfaceFileRequest): boolean {
	if (!keepSurfaceFiles) return false
	if (
		namelistEdits.landmod_namelist?.ALBLAND !== undefined &&
		name.endsWith("0174.sra")
	)
		return false
	if (
		namelistEdits.landmod_namelist?.WSMAX !== undefined &&
		name.endsWith("0229.sra")
	)
		return false
	return !(
		Number(namelistEdits.glacier_namelist?.ICESHEETH) > 0 &&
		INITIAL_ICE_FILES.some((suffix) => name.endsWith(suffix))
	)
}

export const GCM_INPUTS = { keepSurfaceFile }
