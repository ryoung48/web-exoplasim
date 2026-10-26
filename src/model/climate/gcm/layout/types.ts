export type GcmFieldShape = "spectral" | "fourier" | "grid" | "table"

export interface GcmDimensions {
	truncation: number
	latitudes: number
	longitudes: number
	levels: number
}

export interface GcmFieldSpec {
	name: string
	shape: GcmFieldShape
	// Levels for spectral, fourier and grid fields; element count for tables.
	count: number
}

export type GcmTableValues = Record<string, Float64Array>

export interface GcmFieldSlot {
	offset: number
	floats: number
	planeFloats: number
}

export interface GcmLayout {
	dimensions: GcmDimensions
	slots: Record<string, GcmFieldSlot>
	floats: number
}

export interface GcmLayoutRequest {
	dimensions: GcmDimensions
	fields: ReadonlyArray<GcmFieldSpec>
}

export interface GcmLayoutBuffer {
	device: GPUDevice
	layout: GcmLayout
	label: string
}

export interface GcmFieldWrite {
	device: GPUDevice
	buffer: GPUBuffer
	layout: GcmLayout
	name: string
	values: Float32Array<ArrayBuffer>
}

export interface GcmFieldRead {
	device: GPUDevice
	buffer: GPUBuffer
	layout: GcmLayout
	names: ReadonlyArray<string>
}

export interface GcmLayoutConstants {
	layout: GcmLayout
	prefix: string
}
