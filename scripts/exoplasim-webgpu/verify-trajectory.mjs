import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { dumped, loadModules, stepCalendar, stepperConstants, tablesInputs } from "./model-inputs.mjs"
import { readProbe } from "./probe.mjs"

// V4: whole model steps from the f64 reference's state. The GPU and the
// f32 build both start from the f64 dump at `start` (rounded once to f32)
// and run free; after 2 and K steps each field's RMS difference from the
// f64 run must be at most 2× the f32 build's.
const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const output = path.resolve("stats/exoplasim-webgpu/trajectory")
await fs.mkdir(output, { recursive: true })
const CASES = [
	{ truncation: 21, start: 100, checks: [102, 148] },
	{ truncation: 42, start: 100, checks: [102, 132] },
]
// The state at the start of a step: spectral prognostics (current and
// leapfrog old), the surface's prognostic fields, and the physical fields
// the last step left behind.
const FIELDS = [
	...["sd", "sz", "st", "sq", "sp", "sdm", "szm", "stm", "sqm", "spm"],
	...["dt", "dq", "du", "dv", "dp", "dprc", "dprl", "dprs", "dcc", "dalb", "dswfl", "dlwfl", "dshfl", "dlhfl", "devap"],
	...["land_dts", "dsoilt", "dsnowz", "dwatc", "driver", "dcveg", "dcsoil", "dglac"],
	...["xts", "xiced", "xicec", "xsnow", "ysst", "sea_dts"],
	...["localavgprecip", "localavgweather", "localavgtemps"],
]

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const modules = await loadModules(server)
const NEEDED = new Set(modules.STEPPER.fields(10).map((field) => field.name))
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
const report = { cases: [] }
try {
	const page = await browser.newPage()
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await page.goto(server.resolvedUrls.local[0])
	for (const { truncation, start, checks } of CASES) {
		const dump = (precision, step) => readProbe(path.join(probeRoot, `trajectory-${precision}-t${truncation}`, `probe-${step}-a0`))
		const initial = await dump("f64", start)
		const tables = await tablesInputs({ modules, probeRoot, truncation, dump: initial })
		const constants = stepperConstants(initial)
		// Each step's CPU parameters, carbonmod's counter carried along.
		const { step: first, carbonStep, calendar } = stepCalendar(initial)
		const last = Math.max(...checks) - start
		const steps = []
		let counter = carbonStep
		for (let k = 0; k < last; k++) {
			const values = modules.STEPPER.values({ step: first + k, carbonStep: counter, calendar })
			steps.push(Object.fromEntries(Object.entries(values.fields).map(([name, field]) => [name, Array.from(field)])))
			counter = values.carbonStep
		}
		const started = performance.now()
		const gpu = await page.evaluate(async ({ truncation, state, tables, constants, steps, reads, fields }) => {
			const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
			const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
			const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
			const latitudes = { 21: 32, 42: 64 }[truncation]
			const dimensions = { truncation, latitudes, longitudes: 2 * latitudes, levels: 10 }
			const { device } = await GCM_DEVICE.request({ storageBytes: 0, onLost: () => {} })
			const context = STEPPER.context({ device, dimensions, tables })
			const write = ({ name, values }) => LAYOUT.write({ device, buffer: context.stateBuffer, layout: context.state, name, values: Float32Array.from(values) })
			for (const [name, values] of Object.entries(state)) write({ name, values })
			const kernels = await STEPPER.kernels({ context, constants })
			const results = {}
			for (let k = 0; k < steps.length; k++) {
				for (const [name, values] of Object.entries(steps[k])) write({ name, values })
				const encoder = device.createCommandEncoder()
				const pass = encoder.beginComputePass()
				STEPPER.encode({ pass, context, kernels })
				pass.end()
				device.queue.submit([encoder.finish()])
				if (reads.includes(k + 1)) {
					const result = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names: fields })
					results[k + 1] = Object.fromEntries(Object.entries(result).map(([name, values]) => [name, Array.from(values)]))
				}
			}
			device.destroy()
			return { results, dispatches: kernels.length }
		}, { truncation, state: Object.fromEntries([...NEEDED].filter((name) => dumped(initial, name)).map((name) => [name, dumped(initial, name)])), tables, constants, steps, reads: checks.map((check) => check - start), fields: FIELDS })
		const seconds = (performance.now() - started) / 1000
		for (const check of checks) {
			const f64 = await dump("f64", check)
			const f32 = await dump("f32", check)
			const fields = {}
			for (const name of FIELDS) {
				const exact = dumped(f64, name)
				const values = gpu.results[check - start][name]
				const scale = rms(exact)
				const gpuError = rms(values, exact) / scale
				const f32Error = rms(dumped(f32, name), exact) / scale
				const pass = scale === 0 ? rms(values) === 0 : gpuError <= 2 * f32Error
				fields[name] = { gpuRelativeRms: gpuError, f32RelativeRms: f32Error, ratio: gpuError / f32Error, pass }
			}
			const entry = { truncation, start, steps: check - start, pass: Object.values(fields).every((field) => field.pass), dispatchesPerStep: gpu.dispatches, seconds, fields }
			report.cases.push(entry)
			console.log(`T${truncation} ${String(check - start).padStart(2)} steps ${entry.pass ? "pass" : "FAIL"}  ` + Object.entries(fields).map(([name, f]) => `${name}=${f.ratio.toFixed(2)}${f.pass ? "" : "!"}`).join(" "))
		}
	}
	report.errors = errors
	report.chrome = browser.version()
} finally {
	await fs.writeFile(path.join(output, "trajectory.json"), JSON.stringify(report, null, 2))
	await browser.close()
	await server.close()
}

function rms(values, reference) {
	let sum = 0
	for (let i = 0; i < values.length; i++) sum += (values[i] - (reference ? reference[i] : 0)) ** 2
	return Math.sqrt(sum / values.length)
}
