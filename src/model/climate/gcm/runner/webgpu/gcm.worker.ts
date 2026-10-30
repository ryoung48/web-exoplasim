import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import type { GcmAverager } from "@/model/climate/gcm/averages/types"
import { CALENDAR } from "@/model/climate/gcm/calendar"
import { RESTART } from "@/model/climate/gcm/checkpoint/restart"
import { GCM_CONTINUATION } from "@/model/climate/gcm/continuation"
import { GCM_DEVICE } from "@/model/climate/gcm/device"
import { LAYOUT } from "@/model/climate/gcm/layout"
import type {
	GcmStateWrite,
	GcmWorkerModel,
	GcmWorkerPost,
	GcmWorkerRequest,
	GcmWorkerStart,
} from "@/model/climate/gcm/runner/webgpu/types"
import { SETUP } from "@/model/climate/gcm/setup"
import { PUMAMOD } from "@/model/climate/gcm/setup/pumamod"
import { SNAPSHOT } from "@/model/climate/gcm/snapshot"
import { STEPPER } from "@/model/climate/gcm/stepper"
import type { GcmBatchPace } from "@/model/climate/gcm/stepper/types"
import type { GcmLayerCount } from "@/model/climate/gcm/types"

// Staging buffers: IN_FLIGHT batches whose maps are pending, plus two
// mapped batches waiting to be read and posted, so a new batch never waits
// for an older one's readback.
const STAGING_BUFFERS = STEPPER.IN_FLIGHT + 2

let model: GcmWorkerModel | null = null
let step = 0
let carbonStep = 0
let pace: GcmBatchPace = { intervals: 1, estimate: 0 }
let inFlight = 0
// Monthly and annual means over every snapshot, kept here so the page only
// receives the latest snapshot and each closed month.
let averager: GcmAverager = GCM_AVERAGES.create()
// Staging buffers not holding a batch that is queued, running or unmapped.
let free: GPUBuffer[] = []
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
	const { device, adapter, timestamps } = await GCM_DEVICE.request({
		storageBytes: 0,
		onLost: (message) => fail(`GPU device lost: ${message}`),
	})
	device.addEventListener("uncapturederror", (event) =>
		fail((event as GPUUncapturedErrorEvent).error.message),
	)
	const setup = {
		truncation: request.truncation,
		levels: request.layers,
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
			levels: request.layers,
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
	const [kernels, pack, startup] = await Promise.all([
		STEPPER.kernels({ context, constants: schedule.main.stepper }),
		SNAPSHOT.kernel({
			context,
			sigma: schedule.tables.dynamics.sigma,
			humidity: schedule.main.stepper.precipitation,
		}),
		Promise.all(
			request.restart
				? []
				: schedule.startup.map((phase) =>
						STEPPER.kernels({ context, constants: phase.stepper }),
					),
		),
	])
	if (request.restart) {
		const saved = RESTART.decode({
			buffer: request.restart,
			layout: context.state,
		})
		for (const [name, values] of Object.entries(saved.values))
			write({ name, values })
		for (const [name, values] of Object.entries(
			GCM_CONTINUATION.fields({
				config: request.config,
				previousConfig: request.previousConfig,
				initial: initial.fields,
			}),
		))
			write({ name, values })
		if (request.restoreCo2) {
			write({ name: "co2", values: initial.fields.co2 })
			write({ name: "dqco2", values: initial.fields.dqco2 })
		}
		step = saved.step
		carbonStep = saved.carbonStep
	} else {
		for (const [name, values] of Object.entries(initial.fields))
			if (context.state.slots[name]) write({ name, values })
		step = schedule.startStep
		carbonStep = 0
		// master's start-up steps all run at the start step's date.
		for (const [index, phase] of schedule.startup.entries()) {
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
			STEPPER.encode({ pass, context, kernels: startup[index] })
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
				size: STEPPER.TIMING_BYTES + STEPPER.MAX_INTERVALS * snapshotBytes,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			}),
		),
		calendar: schedule.calendar,
		publishEvery: request.publishEvery,
		timing: timestamps
			? {
					querySet: device.createQuerySet({ type: "timestamp", count: 2 }),
					resolve: device.createBuffer({
						label: "batch timestamps",
						size: STEPPER.TIMING_BYTES,
						usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
					}),
				}
			: null,
	}
	free = [...model.staging]
	averager = request.averager ?? GCM_AVERAGES.create()
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

// Submits while the GPU has fewer than IN_FLIGHT batches, so Pause only
// waits for queued GPU work. The page gets one small message per batch (the
// latest snapshot, and the means when a month closes), so it never holds
// the model back.
function pump() {
	while (
		model &&
		!paused &&
		!checkpointPending &&
		!stopped &&
		inFlight < STEPPER.IN_FLIGHT &&
		free.length > 0
	)
		submit(model)
}

// A checkpoint waits for the GPU to finish and for every earlier batch's
// snapshots to be posted, so the page's latest snapshot matches the state.
function checkpointWhenIdle(current: GcmWorkerModel) {
	if (!checkpointPending || inFlight > 0) return
	chain = chain.then(async () => {
		if (stopped || !checkpointPending) return
		await checkpoint(current)
		pump()
	})
}

// One batch of `intervals` publish intervals, ending on a publishing step.
function submit(current: GcmWorkerModel) {
	const { device, context, publishEvery, calendar } = current
	const firstPublish =
		step + ((publishEvery - (step % publishEvery)) % publishEvery)
	const count = firstPublish + (pace.intervals - 1) * publishEvery - step + 1
	const steps = Array.from({ length: count }, (_, k) => {
		const values = STEPPER.values({ step: step + k, carbonStep, calendar })
		carbonStep = values.carbonStep
		return values.fields
	})
	const staging = free.pop() as GPUBuffer
	const batchPace = pace
	const published = pace.intervals
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
			timing: current.timing,
		}),
	])
	step += count
	inFlight++
	const submitted = performance.now()
	const floats = context.state.slots.snapshot.floats
	const bytes = STEPPER.TIMING_BYTES + published * floats * 4
	// Mapping resolves once the GPU has written the batch, so it is also the
	// completion signal: one callback, which arrives on a display frame,
	// instead of onSubmittedWorkDone and then a map. The next batch goes in
	// at once; reading this one back must not hold the GPU idle.
	const ready = staging.mapAsync(GPUMapMode.READ, 0, bytes)
	void ready.then(
		() => {
			if (stopped) return
			inFlight--
			checkpointWhenIdle(current)
			pump()
		},
		(error: unknown) =>
			fail(error instanceof Error ? error.message : String(error)),
	)
	chain = chain.then(async () => {
		await ready
		if (stopped) return
		const finished = performance.now()
		const mapped = staging.getMappedRange(0, bytes)
		const [begin, end] = new BigUint64Array(mapped, 0, 2)
		const data = new Float32Array(mapped.slice(STEPPER.TIMING_BYTES))
		staging.unmap()
		free.push(staging)
		// The GPU's own clock when available; completion callbacks arrive
		// only once per display frame, which would understate every batch.
		pace = STEPPER.pace({
			pace: batchPace,
			milliseconds: current.timing
				? Number(end - begin) / 1e6
				: finished - Math.max(submitted, lastDone),
		})
		lastDone = finished
		const snapshots = Array.from({ length: published }, (_, i) => {
			const at = firstPublish + i * publishEvery
			return {
				layers: context.state.dimensions.levels as GcmLayerCount,
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
		let closed = false
		for (const snapshot of snapshots)
			if (GCM_AVERAGES.add({ averager, snapshot })) closed = true
		post({
			response: {
				type: "progress",
				latest: snapshots[snapshots.length - 1],
				averages: closed
					? { months: averager.months, years: averager.years }
					: null,
			},
			transfer: [],
		})
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
	post({
		response: { type: "checkpoint", restart, averager },
		transfer: [restart],
	})
}

self.onmessage = async (event: MessageEvent<GcmWorkerRequest>) => {
	const request = event.data
	try {
		if (request.type === "start") await start(request)
		else if (request.type === "pause") paused = true
		else if (request.type === "resume") {
			paused = false
			pump()
		} else if (request.type === "checkpoint") {
			checkpointPending = true
			if (model) checkpointWhenIdle(model)
		} else {
			stopped = true
			model?.device.destroy()
			self.close()
		}
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error))
	}
}
