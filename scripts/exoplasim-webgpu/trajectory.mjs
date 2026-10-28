import { chromium } from "playwright"

// Free-running GPU trajectories and their gate, shared by verify-trajectory
// (V4, from a main-loop dump) and verify-startup (from SETUP's fresh start).

// The state at the start of a step: spectral prognostics (current and
// leapfrog old), the surface's prognostic fields, and the physical fields
// the last step left behind.
export const FIELDS = [
	...["sd", "sz", "st", "sq", "sp", "sdm", "szm", "stm", "sqm", "spm"],
	...["dt", "dq", "du", "dv", "dp", "dprc", "dprl", "dprs", "dcc", "dalb", "dswfl", "dlwfl", "dshfl", "dlhfl", "devap"],
	...["land_dts", "dsoilt", "dsnowz", "dwatc", "driver", "dcveg", "dcsoil", "dglac"],
	...["xts", "xiced", "xicec", "xsnow", "ysst", "sea_dts"],
	...["localavgprecip", "localavgweather", "localavgtemps"],
]

export async function openPage(server) {
	const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
	const page = await browser.newPage()
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await page.goto(server.resolvedUrls.local[0])
	return { browser, page, errors }
}

// Runs phases in order on one GPU state. Each phase has its own kernel
// constants, tables to rewrite before it, and steps (each step's CPU
// values); `reads` lists the steps after which FIELDS are read, by label.
export async function runOnGpu({ page, truncation, state, tables, phases }) {
	return page.evaluate(async ({ truncation, state, tables, phases, fields }) => {
		const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
		const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
		const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
		const latitudes = { 21: 32, 42: 64 }[truncation]
		const dimensions = { truncation, latitudes, longitudes: 2 * latitudes, levels: 10 }
		const { device } = await GCM_DEVICE.request({ storageBytes: 0, onLost: () => {} })
		const context = STEPPER.context({ device, dimensions, tables })
		const write = ({ name, values }) => LAYOUT.write({ device, buffer: context.stateBuffer, layout: context.state, name, values: Float32Array.from(values) })
		for (const [name, values] of Object.entries(state)) write({ name, values })
		const kernelSets = await Promise.all(phases.map((phase) => STEPPER.kernels({ context, constants: phase.constants })))
		const results = {}
		const dispatches = []
		for (let p = 0; p < phases.length; p++) {
			const phase = phases[p]
			dispatches.push(kernelSets[p].length)
			for (const [name, values] of Object.entries(phase.tables)) LAYOUT.write({ device, buffer: context.tableBuffer, layout: context.tables, name, values: Float32Array.from(values) })
			for (let k = 0; k < phase.steps.length; k++) {
				for (const [name, values] of Object.entries(phase.steps[k])) write({ name, values })
				const encoder = device.createCommandEncoder()
				const pass = encoder.beginComputePass()
				STEPPER.encode({ pass, context, kernels: kernelSets[p] })
				pass.end()
				device.queue.submit([encoder.finish()])
				const read = phase.reads.find((entry) => entry.after === k + 1)
				if (read) {
					const result = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names: fields })
					results[read.label] = Object.fromEntries(Object.entries(result).map(([name, values]) => [name, Array.from(values)]))
				}
			}
		}
		device.destroy()
		return { results, dispatches }
	}, { truncation, state, tables, phases, fields: FIELDS })
}

// V4's gate: each field's RMS difference from the f64 run at most 2× the
// f32 build's (a field the f64 run leaves at zero must stay zero).
export function judge({ gpu, f64, f32, dumped }) {
	const fields = {}
	for (const name of FIELDS) {
		const exact = dumped(f64, name)
		const values = gpu[name]
		const scale = rms(exact)
		const gpuError = rms(values, exact) / scale
		const f32Error = rms(dumped(f32, name), exact) / scale
		const pass = scale === 0 ? rms(values) === 0 : gpuError <= 2 * f32Error
		fields[name] = { gpuRelativeRms: gpuError, f32RelativeRms: f32Error, ratio: gpuError / f32Error, pass }
	}
	return { pass: Object.values(fields).every((field) => field.pass), fields }
}

export function summary(fields) {
	return Object.entries(fields).map(([name, f]) => `${name}=${f.ratio.toFixed(2)}${f.pass ? "" : "!"}`).join(" ")
}

function rms(values, reference) {
	let sum = 0
	for (let i = 0; i < values.length; i++) sum += (values[i] - (reference ? reference[i] : 0)) ** 2
	return Math.sqrt(sum / values.length)
}
