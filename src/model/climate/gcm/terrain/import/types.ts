export interface GcmTerrainImage {
	name: string
	width: number
	height: number
	samples: Float32Array
	encoding: "normalized" | "metres"
}

export interface GcmTerrainFile {
	name: string
	buffer: ArrayBuffer
}

export interface GcmTerrainMapping {
	blackM: number
	whiteM: number
	seaLevelM: number
	invertMask: boolean
}

export interface GcmTerrainImport {
	heightmap: GcmTerrainImage
	mask: GcmTerrainImage | null
	mapping: GcmTerrainMapping
}
