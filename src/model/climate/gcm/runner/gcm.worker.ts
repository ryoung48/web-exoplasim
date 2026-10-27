import { CALENDAR } from "@/model/climate/gcm/calendar"
import { RESTART } from "@/model/climate/gcm/checkpoint/restart"
import { GCM_DEVICE } from "@/model/climate/gcm/device"
import { LAYOUT } from "@/model/climate/gcm/layout"
import type {
	GcmStateWrite,
	GcmWorkerModel,
	GcmWorkerPost,
	GcmWorkerRequest,
	GcmWorkerStart,
} from "@/model/climate/gcm/runner/types"
import { SETUP } from "@/model/climate/gcm/setup"
import { PUMAMOD } from "@/model/climate/gcm/setup/pumamod"
import { SNAPSHOT } from "@/model/climate/gcm/snapshot"
import { STEPPER } from "@/model/climate/gcm/stepper"

// DP5.3: triple-buffered staging, so mapping one never blocks the next batch.
const STAGING_BUFFERS = 3
const LEVELS = 10

let model: GcmWorkerModel | null = null
let step = 0
let carbonStep = 0
let intervals = 1
let inFlight = 0
// Batches of snapshots posted and not yet handled by the page.
let unacknowledged = 0
let ring = 0
let lastDone = 0
let paused = false
let checkpointPending = false
let stopped = false
let chain = Promise.resolve()

function post({ response, transfer }: GcmWorkerPost) {
	self.postMessage(response, { transfer })
}

function fail(message: string) {
	if (stopped) return
	stopped = true
	post({ response: { type: "error", message }, transfer: [] })
}

async function start(request: GcmWorkerStart) {
	const { device, adapter } = await GCM_DEVICE.request({
		storageBytes: 0,
		onLost: (message) => fail(`GPU device lost: ${message}`),
	})
	device.addEventListener("uncapturederror", (event) =>
		fail((event as GPUUncapturedErrorEvent).error.message),
	)
	const setup = {
		truncation: request.truncation,
		levels: LEVELS,
		namelists: request.files,
	}
	const initial = SETUP.state({ ...setup, clock: Date.now() })
	const schedule = SETUP.schedule({ request: setup, state: initial })
	const latitudes = PUMAMOD.latitudes(request.truncation)
	const context = STEPPER.context({
		device,
		dimensions: {
			truncation: request.truncation,
			latitudes,
			longitudes: 2 * latitudes,
			levels: LEVELS,
		},
		tables: schedule.tables,
	})
	const write = ({ name, values }: GcmStateWrite) =>
		LAYOUT.write({
			device,
			buffer: context.stateBuffer,
			layout: context.state,
			name,
			values: Float32Array.from(values),
		})
	const writeBm1 = (values: Float64Array) =>
		LAYOUT.write({
			device,
			buffer: context.tableBuffer,
			layout: context.tables,
			name: "bm1",
			values: Float32Array.from(values),
		})
	const [kernels, pack] = await Promise.all([
		STEPPER.kernels({ context, constants: schedule.main.stepper }),
		SNAPSHOT.kernel({ context, sigma: schedule.tables.dynamics.sigma }),
	])
	if (request.restart) {
		const saved = RESTART.decode({
			buffer: request.restart,
			layout: context.state,
		})
		for (const [name, values] of Object.entries(saved.values))
			write({ name, values })
		step = saved.step
		carbonStep = saved.carbonStep
	} else {
		for (const [name, values] of Object.entries(initial.fields))
			if (context.state.slots[name]) write({ name, values })
		step = schedule.startStep
		carbonStep = 0
		// master's start-up steps all run at the start step's date.
		for (const phase of schedule.startup) {
			const startup = await STEPPER.kernels({
				context,
				constants: phase.stepper,
			})
			writeBm1(phase.bm1)
			const values = STEPPER.values({
				step,
				carbonStep,
				calendar: schedule.calendar,
			})
			carbonStep = values.carbonStep
			for (const [name, field] of Object.entries(values.fields))
				write({ name, values: field })
			const encoder = device.createCommandEncoder()
			const pass = encoder.beginComputePass()
			STEPPER.encode({ pass, context, kernels: startup })
			pass.end()
			device.queue.submit([encoder.finish()])
		}
	}
	writeBm1(schedule.main.bm1)
	const probe = STEPPER.values({
		step,
		carbonStep,
		calendar: schedule.calendar,
	})
	const stepFloats = Object.keys(probe.fields).reduce(
		(sum, name) => sum + context.state.slots[name].floats,
		0,
	)
	const maxSteps = (STEPPER.MAX_INTERVALS + 1) * request.publishEvery
	const snapshotBytes = context.state.slots.snapshot.floats * 4
	model = {
		device,
		context,
		kernels,
		pack,
		params: device.createBuffer({
			label: "step parameters",
			size: maxSteps * stepFloats * 4,
			usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		}),
		staging: Array.from({ length: STAGING_BUFFERS }, (_, i) =>
			device.createBuffer({
				label: `snapshot staging ${i}`,
				size: STEPPER.MAX_INTERVALS * snapshotBytes,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			}),
		),
		calendar: schedule.calendar,
		publishEvery: request.publishEvery,
	}
	paused = request.startPaused
	post({
		response: {
			type: "loaded",
			device:
				[adapter.vendor, adapter.architecture].filter(Boolean).join(" ") ||
				"WebGPU",
		},
		transfer: [],
	})
	pump()
}

// Submits while the GPU has fewer than IN_FLIGHT batches and the page has
// handled every posted batch, so Pause only waits for queued GPU work and
// at most one batch of snapshots. Each batch is one message: the page
// handles a message per turn between frames, not a snapshot per turn.
function pump() {
	while (
		model &&
		!paused &&
		!checkpointPending &&
		!stopped &&
		inFlight < STEPPER.IN_FLIGHT &&
		unacknowledged < 1
	)
		submit(model)
}

// One batch of `intervals` publish intervals, ending on a publishing step.
function submit(current: GcmWorkerModel) {
	const { device, context, publishEvery, calendar } = current
	const firstPublish =
		step + ((publishEvery - (step % publishEvery)) % publishEvery)
	const count = firstPublish + (intervals - 1) * publishEvery - step + 1
	const steps = Array.from({ length: count }, (_, k) => {
		const values = STEPPER.values({ step: step + k, carbonStep, calendar })
		carbonStep = values.carbonStep
		return values.fields
	})
	const staging = current.staging[ring]
	ring = (ring + 1) % STAGING_BUFFERS
	const published = intervals
	device.queue.submit([
		STEPPER.batch({
			context,
			kernels: current.kernels,
			pack: current.pack,
			params: current.params,
			steps,
			firstStep: step,
			publishEvery,
			staging,
		}),
	])
	step += count
	inFlight++
	const submitted = performance.now()
	const done = device.queue.onSubmittedWorkDone()
	chain = chain.then(async () => {
		await done
		if (stopped) return
		const finished = performance.now()
		intervals = STEPPER.intervals({
			previous: published,
			milliseconds: finished - Math.max(submitted, lastDone),
		})
		lastDone = finished
		const floats = context.state.slots.snapshot.floats
		await staging.mapAsync(GPUMapMode.READ, 0, published * floats * 4)
		const data = new Float32Array(
			staging.getMappedRange(0, published * floats * 4).slice(0),
		)
		staging.unmap()
		const snapshots = Array.from({ length: published }, (_, i) => {
			const at = firstPublish + i * publishEvery
			return {
				step: at,
				date: CALENDAR.date({
					step: at,
					stepsPerDay: calendar.stepsPerDay,
					daysPerYear: calendar.daysPerYear,
					stepMinutes: calendar.stepMinutes,
				}),
				values: data.slice(i * floats, (i + 1) * floats),
			}
		})
		const unstable = snapshots.find(
			(snapshot) => !snapshot.values.every(Number.isFinite),
		)
		if (unstable) {
			fail(`The model became unstable at step ${unstable.step}`)
			return
		}
		unacknowledged++
		post({
			response: { type: "snapshots", snapshots },
			transfer: snapshots.map((snapshot) => snapshot.values.buffer),
		})
		inFlight--
		if (checkpointPending && inFlight === 0) await checkpoint(current)
		pump()
	})
}

async function checkpoint(current: GcmWorkerModel) {
	const { device, context } = current
	const values = await LAYOUT.read({
		device,
		buffer: context.stateBuffer,
		layout: context.state,
		names: Object.keys(context.state.slots),
	})
	const restart = RESTART.encode({
		layout: context.state,
		values,
		step,
		carbonStep,
	})
	checkpointPending = false
	post({ response: { type: "checkpoint", restart }, transfer: [restart] })
}

self.onmessage = async (event: MessageEvent<GcmWorkerRequest>) => {
	const request = event.data
	try {
		if (request.type === "start") await start(request)
		else if (request.type === "pause") paused = true
		else if (request.type === "ack") {
			unacknowledged--
			pump()
		} else if (request.type === "resume") {
			paused = false
			pump()
		} else if (request.type === "checkpoint") {
			checkpointPending = true
			if (model && inFlight === 0) {
				await checkpoint(model)
				pump()
			}
		} else {
			stopped = true
			model?.device.destroy()
			self.close()
		}
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error))
	}
}
