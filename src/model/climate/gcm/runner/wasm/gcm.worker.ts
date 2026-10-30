import { NATIVE_RESTART } from "@/model/climate/gcm/checkpoint/native"
import { GCM_CONTINUATION } from "@/model/climate/gcm/continuation"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import type { GcmNamelistFile } from "@/model/climate/gcm/namelist/types"
import { GCM_INPUTS } from "@/model/climate/gcm/runner/inputs"
import type {
	ExoplasimFactory,
	ExoplasimModule,
	ExoplasimPublishedFields,
	GcmWasmWorkerLoad,
	GcmWasmWorkerRequest,
	GcmWasmWorkerResponse,
} from "@/model/climate/gcm/runner/wasm/types"
import { SETUP } from "@/model/climate/gcm/setup"

import type { GcmLayerCount } from "@/model/climate/gcm/types"

let loadedLayers: GcmLayerCount = 10

const PAUSED = 0
const STOP = 1
const ABORTED = 2
// PlaSim reads plasim_restart at startup and writes plasim_status in its
// epilog (plasimmod.f90).
const RESTART_IN = "/plasim_restart"
const RESTART_OUT = "/plasim_status"
const log: string[] = []
let model: ExoplasimModule | null = null
let exitCode = 0
let exchange: SharedArrayBuffer | null = null

function post(response: GcmWasmWorkerResponse) {
	self.postMessage(response)
}

function abortOtherRanks() {
	if (!exchange) return
	const control = new Int32Array(exchange, 0, 16)
	Atomics.store(control, ABORTED, 1)
	Atomics.notify(control, 1)
}

function publish(fields: ExoplasimPublishedFields) {
	if (fields.fields !== GCM_FIELDS.fieldCount(loadedLayers)) {
		throw new Error(
			"GCM snapshot layout mismatch; reload the rebuilt model assets",
		)
	}
	const [year, month, day, hour, minute] = fields.date
	const response: GcmWasmWorkerResponse = {
		type: "snapshot",
		snapshot: {
			layers: loadedLayers,
			step: fields.step,
			date: { year, month, day, hour, minute },
			values: fields.values,
		},
	}
	self.postMessage(response, { transfer: [fields.values.buffer] })
}

function prepareFiles(request: GcmWasmWorkerLoad) {
	if (!model) return
	const fs = model.FS
	for (const name of fs.readdir("/")) {
		if (
			name.endsWith(".sra") &&
			!GCM_INPUTS.keepSurfaceFile({
				name,
				keepSurfaceFiles: request.keepSurfaceFiles,
				namelistEdits: request.namelistEdits,
			})
		) {
			fs.unlink(`/${name}`)
		}
	}
	for (const [name, text] of Object.entries(request.files)) {
		fs.writeFile(`/${name}`, text)
	}

	for (const [file, values] of Object.entries(request.namelistEdits)) {
		const path = `/${file as GcmNamelistFile}`
		fs.writeFile(
			path,
			GCM_NAMELIST.apply({
				text: fs.readFile(path, { encoding: "utf8" }),
				values,
			}),
		)
	}
	if (request.restart) {
		let restart = request.restart
		if (request.previousConfig) {
			const namelists = Object.fromEntries(
				fs
					.readdir("/")
					.filter((name) => name.endsWith("_namelist") || name.endsWith(".sra"))
					.map((name) => [name, fs.readFile(`/${name}`, { encoding: "utf8" })]),
			)
			const initial = SETUP.state({
				truncation: request.previousConfig.truncation,
				levels: request.layers,
				namelists,
				clock: 0,
			})
			const fields = GCM_CONTINUATION.fields({
				config: request.config,
				previousConfig: request.previousConfig,
				initial: initial.fields,
			})
			restart = NATIVE_RESTART.patch({
				buffer: restart,
				fields: Object.fromEntries(
					Object.entries(fields).filter(([name]) =>
						["dwmax", "dalbcl", "dalbcl1", "dalbcl2"].includes(name),
					),
				),
			})
		}
		fs.writeFile(RESTART_IN, new Uint8Array(restart))
	}
}

async function load(request: GcmWasmWorkerLoad) {
	loadedLayers = request.layers
	exchange = request.exchange
	const control = new Int32Array(request.control)
	const factory = (
		(await import(/* @vite-ignore */ request.moduleUrl)) as {
			default: ExoplasimFactory
		}
	).default
	model = await factory({
		noInitialRun: true,
		print: (line) => log.push(line),
		printErr: (line) => log.push(line),
		onExit: (code) => {
			exitCode = code
		},
		locateFile: (path) =>
			path.endsWith(".data")
				? request.dataUrl
				: new URL(path, request.moduleUrl).href,
		shm: {
			sab: request.exchange,
			rank: request.rank,
			size: request.size,
			spin: request.spin,
		},
		gcm: {
			shouldPublish: (step) => {
				if (request.rank === 0) {
					while (
						Atomics.load(control, PAUSED) === 1 &&
						Atomics.load(control, STOP) === 0
					) {
						Atomics.wait(control, PAUSED, 1)
					}
				}
				return step % request.publishEvery === 0
			},
			shouldStop: () => Atomics.load(control, STOP) === 1,
			publish,
		},
	})
	prepareFiles(request)
	post({ type: "loaded" })
}

function savedRestart(): ArrayBuffer | null {
	if (!model?.FS.analyzePath(RESTART_OUT).exists) return null
	return model.FS.readFile(RESTART_OUT).slice().buffer
}

function run() {
	model?.callMain([])
	if (exitCode !== 0) abortOtherRanks()
	const restart = exitCode === 0 ? savedRestart() : null
	const response: GcmWasmWorkerResponse = {
		type: "exit",
		code: exitCode,
		log: log.slice(-40),
		restart,
	}
	self.postMessage(response, { transfer: restart ? [restart] : [] })
}

self.onmessage = async (event: MessageEvent<GcmWasmWorkerRequest>) => {
	try {
		if (event.data.type === "load") await load(event.data)
		else run()
	} catch (error) {
		abortOtherRanks()
		post({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
			log: log.slice(-40),
		})
	}
}
