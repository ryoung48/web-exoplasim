import type { GcmNamelistEdits } from "@/model/climate/gcm/namelist/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"
import type {
	GcmConfig,
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

export interface GcmWorkerLoad {
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

export interface GcmWorkerRun {
	type: "run"
}

export type GcmWorkerRequest = GcmWorkerLoad | GcmWorkerRun

export type GcmWorkerResponse =
	| { type: "loaded" }
	| { type: "snapshot"; snapshot: GcmSnapshot }
	| { type: "exit"; code: number; log: string[]; restart: ArrayBuffer | null }
	| { type: "error"; message: string; log: string[] }

export type GcmRunStatus =
	| "loading"
	| "running"
	| "paused"
	| "checkpointing"
	| "finished"
	| "failed"

export interface GcmStatusUpdate {
	status: GcmRunStatus
	message: string
}

export interface GcmRunRequest {
	config: GcmConfig
	terrain: GcmTerrain
	resolution: GcmResolution
	ranks: number
	publishEvery: number
	restart: ArrayBuffer | null
	startPaused: boolean
	onSnapshot(snapshot: GcmSnapshot): void
	onStatus(update: GcmStatusUpdate): void
	onCheckpoint(restart: ArrayBuffer): void
}

export interface GcmRun {
	pause(): void
	resume(): void
	checkpoint(): void
	stop(): void
}

export interface GcmResolution {
	layers: GcmLayerCount
	truncation: GcmTruncation
	latitudes: number
	precisionBytes: number
	ranks: number[]
	downloadBytes: number
}

export interface GcmManifest {
	resolutions: GcmResolution[]
}

export interface GcmRankChoice {
	available: ReadonlyArray<number>
	hardwareThreads: number
}
