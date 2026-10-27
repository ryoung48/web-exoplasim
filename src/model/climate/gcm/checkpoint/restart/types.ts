import type { GcmLayout } from "@/model/climate/gcm/layout/types"

// The GPU state at a step boundary: every field by name, the next main-loop
// step to run and carbonmod's counter before it.
export interface GcmRestartState {
	values: Record<string, Float32Array>
	step: number
	carbonStep: number
}

export interface GcmRestartEncode extends GcmRestartState {
	layout: GcmLayout
}

export interface GcmRestartDecode {
	buffer: ArrayBuffer
	layout: GcmLayout
}

export interface GcmRestartHeader {
	fields: Array<[string, number]>
	step: number
	carbonStep: number
}
