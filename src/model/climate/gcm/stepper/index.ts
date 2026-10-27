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
import { SURFACE } from "@/model/climate/gcm/physics/surface"
import { SURFACE_FLUX } from "@/model/climate/gcm/physics/surface-flux"
import type {
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
// carbonstep, the frame out), spectrald. Output, diagnostics and
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
	] = await Promise.all([
		DYNAMICS.kernels({ context, constants: constants.dynamics }),
		FIXER.kernels({ context, ...constants.fixer }),
		SURFACE_FLUX.kernels({ context, constants: constants.surfaceFlux }),
		RADIATION.kernels({ context, constants: constants.radiation }),
		PRECIPITATION.kernels({ context, constants: constants.precipitation }),
		SURFACE.kernels({ context, constants: constants.surface }),
		CARBON.kernels({ context, constants: constants.carbon }),
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
		...dynamics.physicsOut,
		...dynamics.spectrald,
	]
}

function encode({ pass, context, kernels }: GcmStepperEncode): void {
	for (const kernel of kernels) KERNEL.dispatch({ pass, context, kernel })
}

// The CPU's per-step parameters: solang's orbit, momint's month weights
// (nstep for the ice climatology, nstep + 1 for the rest) and carbonmod's
// weathering counter.
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
		step,
		stepsPerYear: calendar.stepsPerYear,
		stepsPerDay: calendar.stepsPerDay,
		stepMinutes: calendar.stepMinutes,
		orbit: calendar.orbit,
	})
	const cycle = CARBON.cycle({
		cstep: carbonStep,
		interval: calendar.carbonInterval,
	})
	return {
		fields: {
			radiation_step: RADIATION.step({
				solar,
				rotationSpeed: calendar.rotationSpeed,
				toffo3: calendar.toffo3,
			}),
			surface_step: SURFACE.step({ now: month(step), next: month(step + 1) }),
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
}
