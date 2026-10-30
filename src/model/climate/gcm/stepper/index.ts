import { CALENDAR } from "@/model/climate/gcm/calendar"
import { DYNAMICS } from "@/model/climate/gcm/dynamics"
import { FOURIER } from "@/model/climate/gcm/fourier"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { KERNEL } from "@/model/climate/gcm/kernel"
import type {
	GcmKernel,
	GcmKernelContext,
} from "@/model/climate/gcm/kernel/types"
import { LAYOUT } from "@/model/climate/gcm/layout"
import type {
	GcmFieldSpec,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"
import { LEGENDRE } from "@/model/climate/gcm/legendre"
import { CARBON } from "@/model/climate/gcm/physics/carbon"
import { FIXER } from "@/model/climate/gcm/physics/fixer"
import { LAND } from "@/model/climate/gcm/physics/land"
import { PRECIPITATION } from "@/model/climate/gcm/physics/precipitation"
import { RADIATION } from "@/model/climate/gcm/physics/radiation"
import { STORM } from "@/model/climate/gcm/physics/storm"
import { SURFACE } from "@/model/climate/gcm/physics/surface"
import { SURFACE_FLUX } from "@/model/climate/gcm/physics/surface-flux"
import { SNAPSHOT } from "@/model/climate/gcm/snapshot"
import type {
	GcmBatchPace,
	GcmBatchRequest,
	GcmBatchSizing,
	GcmStepperContextRequest,
	GcmStepperEncode,
	GcmStepperRequest,
	GcmStepperTablesBuild,
	GcmStepValues,
	GcmStepValuesRequest,
} from "@/model/climate/gcm/stepper/types"

// The whole model state: every domain's fields.
function fields(levels: number): GcmFieldSpec[] {
	return [
		...DYNAMICS.fields(levels),
		...FIXER.fields(levels),
		...SURFACE_FLUX.fields(),
		...RADIATION.fields(levels),
		...PRECIPITATION.fields(levels),
		...SURFACE.fields(),
		...CARBON.fields(),
		...STORM.fields(),
		...SNAPSHOT.fields(levels),
	]
}

function tables({
	grid,
	truncation,
	request,
}: GcmStepperTablesBuild): GcmTableValues {
	const { filters, akap, gascon, ga, vdiffLamm, vdiffD, acllwr } = request
	const { rcritmod, rcritslope, dsoilz } = request
	const dynamics = Object.fromEntries(
		Object.entries(request.dynamics).map(([name, values]) => [
			name,
			Float64Array.from(values),
		]),
	)
	const fourier = FOURIER.tables({ longitudes: grid.longitudes, truncation })
	const { sigma, sigmah, dsigma } = dynamics
	return {
		fourier_forward: fourier.forward,
		fourier_inverse: fourier.inverse,
		...LEGENDRE.kernelTables({
			tables: LEGENDRE.tables({ grid, truncation }),
			filters: LEGENDRE.filters(filters),
			truncation,
		}),
		...FIXER.tables({ grid }),
		...SURFACE_FLUX.tables({
			sigma,
			sigmah,
			akap,
			gascon,
			ga,
			vdiffLamm,
			vdiffD,
		}),
		...RADIATION.tables({ grid, sigma, sigmah, dsigma, ga, acllwr }),
		...PRECIPITATION.tables({ sigma, akap, rcritmod, rcritslope }),
		...LAND.tables({ dsoilz }),
		...dynamics,
	}
}

// The state and table buffers with every table written, and the kernel
// context over them.
function context({
	device,
	dimensions,
	tables: request,
}: GcmStepperContextRequest): GcmKernelContext {
	const state = LAYOUT.create({ dimensions, fields: fields(dimensions.levels) })
	const values = tables({
		grid: GCM_GRID.forLatitudes(dimensions.latitudes),
		truncation: dimensions.truncation,
		request,
	})
	const layout = LAYOUT.create({
		dimensions,
		fields: LAYOUT.tableFields(values),
	})
	const result = KERNEL.context({ device, state, tables: layout })
	for (const [name, table] of Object.entries(values))
		LAYOUT.write({
			device,
			buffer: result.tableBuffer,
			layout,
			name,
			values: Float32Array.from(table),
		})
	return result
}

// One model step in master's order: gridpointa, spectrala, gridpointd
// (the frame in, miscstep's fixer, fluxstep, radstep, rainstep, surfstep,
// carbonstep, hurricanestep, the frame out), spectrald. Output and
// stability_check only read the state.
async function kernels({
	context,
	constants,
}: GcmStepperRequest): Promise<GcmKernel[]> {
	const [
		dynamics,
		fixer,
		surfaceFlux,
		radiation,
		precipitation,
		surface,
		carbon,
		storm,
	] = await Promise.all([
		DYNAMICS.kernels({ context, constants: constants.dynamics }),
		FIXER.kernels({ context, ...constants.fixer }),
		SURFACE_FLUX.kernels({ context, constants: constants.surfaceFlux }),
		RADIATION.kernels({ context, constants: constants.radiation }),
		PRECIPITATION.kernels({ context, constants: constants.precipitation }),
		SURFACE.kernels({ context, constants: constants.surface }),
		CARBON.kernels({ context, constants: constants.carbon }),
		STORM.kernels({ context, constants: constants.storm }),
	])
	return [
		...dynamics.gridpointa,
		...dynamics.spectrala,
		...dynamics.physicsIn,
		...fixer,
		...surfaceFlux,
		...radiation,
		...precipitation,
		...surface,
		...carbon,
		...storm,
		...dynamics.physicsOut,
		...dynamics.spectrald,
	]
}

function encode({ pass, context, kernels }: GcmStepperEncode): void {
	for (const kernel of kernels) KERNEL.dispatch({ pass, context, kernel })
}

// DP5.2: a batch is a whole number of publish intervals sized to about
// BATCH_BUDGET_MS of GPU time, with at most IN_FLIGHT batches queued. While
// the page draws, a batch takes up to ~1.7× its budget on the GPU: the
// plan's 25 ms let Pause reach 93 ms, 20 ms kept 30 presses under 78 ms for
// 5% less speed, and 15 ms halved speed (docs).
// MAX_INTERVALS bounds a staging buffer (99 fields × 8192 points × 4 B ×
// 16 = 50 MiB at T42 with ten atmospheric layers).
const BATCH_BUDGET_MS = 20
const IN_FLIGHT = 2
const MAX_INTERVALS = 16
// A batch's begin and end GPU timestamps (two u64 nanosecond values).
const TIMING_BYTES = 16

// The per-interval GPU time estimate follows a slower batch at once but a
// faster one only by ESTIMATE_DECAY per batch, so one fast measurement
// cannot double the next batch past the budget.
const ESTIMATE_DECAY = 0.8

function pace({ pace: previous, milliseconds }: GcmBatchSizing): GcmBatchPace {
	if (!(milliseconds > 0)) return previous
	const sample = milliseconds / previous.intervals
	const estimate = Math.max(sample, ESTIMATE_DECAY * previous.estimate)
	const intervals = Math.floor(BATCH_BUDGET_MS / estimate)
	return {
		estimate,
		intervals: Math.min(MAX_INTERVALS, Math.max(1, intervals)),
	}
}

// One batch as one command buffer: each step copies its CPU values from
// `params` into the state and runs master's step. Like gcm_publish_step, a
// step whose nstep is a multiple of publishEvery then packs the snapshot,
// copied to the next slot of `staging`, after TIMING_BYTES. With `timing`,
// the first pass writes a begin and the last an end GPU timestamp, copied
// to the start of `staging`.
function batch({
	context,
	kernels,
	pack,
	params,
	steps,
	firstStep,
	publishEvery,
	staging,
	timing,
}: GcmBatchRequest): GPUCommandBuffer {
	const { device, state, stateBuffer } = context
	const names = Object.keys(steps[0] ?? {})
	const floats = names.reduce((sum, name) => sum + state.slots[name].floats, 0)
	const values = new Float32Array(floats * steps.length)
	steps.forEach((step, k) => {
		let at = k * floats
		for (const name of names) {
			values.set(step[name], at)
			if (name === "snapshot_step")
				values[at + 2] = (firstStep + k) % publishEvery === 0 ? 1 : 0
			at += state.slots[name].floats
		}
	})
	device.queue.writeBuffer(params, 0, values)
	const snapshot = state.slots.snapshot
	const encoder = device.createCommandEncoder()
	let published = 0
	steps.forEach((_, k) => {
		let at = k * floats
		for (const name of names) {
			const slot = state.slots[name]
			encoder.copyBufferToBuffer(
				params,
				at * 4,
				stateBuffer,
				slot.offset * 4,
				slot.floats * 4,
			)
			at += slot.floats
		}
		const first = k === 0
		const last = k === steps.length - 1
		const pass = encoder.beginComputePass(
			timing && (first || last)
				? {
						timestampWrites: {
							querySet: timing.querySet,
							...(first ? { beginningOfPassWriteIndex: 0 } : {}),
							...(last ? { endOfPassWriteIndex: 1 } : {}),
						},
					}
				: {},
		)
		encode({ pass, context, kernels })
		const publishes = (firstStep + k) % publishEvery === 0
		KERNEL.dispatch({ pass, context, kernel: pack })
		pass.end()
		if (!publishes) return
		encoder.copyBufferToBuffer(
			stateBuffer,
			snapshot.offset * 4,
			staging,
			TIMING_BYTES + published * snapshot.floats * 4,
			snapshot.floats * 4,
		)
		published++
	})
	if (timing) {
		encoder.resolveQuerySet(timing.querySet, 0, 2, timing.resolve, 0)
		encoder.copyBufferToBuffer(timing.resolve, 0, staging, 0, TIMING_BYTES)
	}
	return encoder.finish()
}

// The CPU's per-step parameters: solang's orbit, momint's month weights
// (nstep for the ice climatology, nstep + 1 for the rest), the calendar
// year's end and carbonmod's weathering counter.
function values({
	step,
	carbonStep,
	calendar,
}: GcmStepValuesRequest): GcmStepValues {
	const month = (at: number) =>
		CALENDAR.monthInterpolation({
			step: at,
			stepsPerDay: calendar.stepsPerDay,
			daysPerYear: calendar.daysPerYear,
			daysPerMonth: calendar.daysPerMonth,
			stepMinutes: calendar.stepMinutes,
			solarDay: calendar.solarDay,
		})
	const solar = CALENDAR.solar({
		keplerian: calendar.keplerian,
		synchronous: calendar.fixedSun !== null,
		step,
		stepsPerYear: calendar.stepsPerYear,
		stepsPerDay: calendar.stepsPerDay,
		stepMinutes: calendar.stepMinutes,
		orbit: calendar.orbit,
	})
	const year = (at: number) =>
		CALENDAR.date({
			step: at,
			stepsPerDay: calendar.stepsPerDay,
			daysPerYear: calendar.daysPerYear,
			stepMinutes: calendar.stepMinutes,
		}).year
	const cycle = CARBON.cycle({
		cstep: carbonStep,
		interval: calendar.carbonInterval,
	})
	return {
		fields: {
			snapshot_step: Float64Array.of(step, calendar.stepsPerDay, 0),
			radiation_step: RADIATION.step({
				keplerian: calendar.keplerian,
				fixedSun: calendar.fixedSun,
				solar,
				rotationSpeed: calendar.rotationSpeed,
				toffo3: calendar.toffo3,
			}),
			surface_step: SURFACE.step({
				now: month(step),
				next: month(step + 1),
				yearEnds: year(step + 1) !== year(step),
			}),
			carbon_step: Float64Array.of(cycle.weathers ? 1 : 0),
		},
		carbonStep: cycle.cstep,
	}
}

export const STEPPER = {
	fields,
	context,
	kernels,
	encode,
	values,
	IN_FLIGHT,
	MAX_INTERVALS,
	TIMING_BYTES,
	pace,
	batch,
}
