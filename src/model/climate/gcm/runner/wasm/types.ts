import type { GcmAverager } from "@/model/climate/gcm/averages/types"
import type { GcmNamelistEdits } from "@/model/climate/gcm/namelist/types"
import type {
	GcmCpuBuild,
	GcmRunCheckpoint,
	GcmRunRequest,
} from "@/model/climate/gcm/runner/types"
import type {
	GcmLayerCount,
	GcmSnapshot,
	GcmTruncation,
} from "@/model/climate/gcm/types"

export interface ExoplasimPathInfo {
	exists: boolean
}

export interface ExoplasimFileSystem {
	readFile(path: string, options: { encoding: "utf8" }): string
	readFile(path: string): Uint8Array
	writeFile(path: string, data: Uint8Array): void
	analyzePath(path: string): ExoplasimPathInfo
	writeFile(path: string, data: string): void
	unlink(path: string): void
	readdir(path: string): string[]
}

export interface ExoplasimModule {
	FS: ExoplasimFileSystem
	callMain(args: string[]): void
}

export interface ExoplasimPublishedFields {
	step: number
	date: number[]
	fields: number
	points: number
	values: Float32Array
}

export interface ExoplasimSharedMemory {
	sab: SharedArrayBuffer
	rank: number
	size: number
	spin: number
}

export interface ExoplasimSnapshotHooks {
	shouldPublish(step: number): boolean
	shouldStop(): boolean
	publish(fields: ExoplasimPublishedFields): void
}

export interface ExoplasimModuleOptions {
	noInitialRun: boolean
	print(line: string): void
	printErr(line: string): void
	onExit(code: number): void
	locateFile(path: string): string
	shm: ExoplasimSharedMemory
	gcm: ExoplasimSnapshotHooks
}

export type ExoplasimFactory = (
	options: ExoplasimModuleOptions,
) => Promise<ExoplasimModule>

export interface GcmWasmWorkerLoad {
	layers: GcmLayerCount
	type: "load"
	rank: number
	size: number
	exchange: SharedArrayBuffer
	control: SharedArrayBuffer
	moduleUrl: string
	dataUrl: string
	files: Record<string, string>
	keepSurfaceFiles: boolean
	restart: ArrayBuffer | null
	namelistEdits: GcmNamelistEdits
	publishEvery: number
	spin: number
}

export interface GcmWasmWorkerRun {
	type: "run"
}

export type GcmWasmWorkerRequest = GcmWasmWorkerLoad | GcmWasmWorkerRun

export type GcmWasmWorkerResponse =
	| { type: "loaded" }
	| { type: "snapshot"; snapshot: GcmSnapshot }
	| { type: "exit"; code: number; log: string[]; restart: ArrayBuffer | null }
	| { type: "error"; message: string; log: string[] }

// public/gcm/manifest.json, written by scripts/exoplasim-wasm/build_app.py.
export interface GcmCpuManifest {
	resolutions: GcmCpuManifestEntry[]
}

export interface GcmCpuManifestEntry extends GcmCpuBuild {
	layers: GcmLayerCount
	truncation: GcmTruncation
	latitudes: number
}

export interface GcmRankChoice {
	available: ReadonlyArray<number>
	hardwareThreads: number
}

// One run of the Wasm model, from a fresh start or a restart, until it
// ends; a checkpoint ends it and the runner starts the next session.
export interface GcmWasmSession {
	request: GcmRunRequest
	files: Record<string, string>
	ranks: number
	averager: GcmAverager
	restart: ArrayBuffer | null
	startPaused: boolean
	onSaved(saved: GcmRunCheckpoint): void
}
