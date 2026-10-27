import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmPumamod } from "@/model/climate/gcm/setup/pumamod/types"

// The state surfini, seaini and radini leave, under STEPPER's field names
// and layouts (dsalb band-contiguous), and the spectral orography so.
export interface GcmSurfaceState {
	fields: Record<string, Float64Array>
	so: Float64Array
}

export interface GcmSurfaceRead {
	files: Record<string, string>
	code: number
	grid: GcmGrid
	months: number
}

// A surface file's field by code, or the module's preset when the page
// supplies none.
export interface GcmSurfaceField {
	code: number
	fallback: number
}

// maxval (sign 1) or minval (sign -1) of a field.
export interface GcmExtremeRequest {
	values: Float64Array
	sign: number
}

export interface GcmRunoffRate {
	slope: number
	spacing: number
	sign: number
}

// landini's glacier albedo between its bounds, by surface temperature.
export interface GcmGlacierAlbedo {
	max: number
	min: number
	ts: number
	tmelt: number
}

// getalb's wet-soil albedo for bare soil wetness bf = dwater / wsmax.
export interface GcmWetSoilAlbedo {
	bf: number
	dry: number
	ocean: number
}

export interface GcmMonthlyValue {
	table: Float64Array
	step: number
	pumamod: GcmPumamod
	points: number
}

export interface GcmSaturationRequest {
	temperature: number
	pumamod: GcmPumamod
}

// oroini's river routing over orography (m²/s²) and the binary land mask.
export interface GcmRunoffRequest {
	orography: Float64Array
	mask: Float64Array
	grid: GcmGrid
	pumamod: GcmPumamod
}

export interface GcmRunoff {
	duroff: Float64Array
	dvroff: Float64Array
}

export interface GcmIceThicknessRequest {
	cover: Float64Array
	grid: GcmGrid
}
