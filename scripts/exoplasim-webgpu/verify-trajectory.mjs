import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "vite"
import { dumped, loadModules, stepCalendar, stepperConstants, tablesInputs } from "./model-inputs.mjs"
import { readProbe } from "./probe.mjs"
import { judge, openPage, runOnGpu, summary } from "./trajectory.mjs"

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

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const modules = await loadModules(server)
const NEEDED = new Set(modules.STEPPER.fields(10).map((field) => field.name))
const { browser, page, errors } = await openPage(server)
const report = { cases: [] }
try {
	for (const { truncation, start, checks } of CASES) {
		const dump = (precision, step) => readProbe(path.join(probeRoot, `trajectory-${precision}-t${truncation}`, `probe-${step}-a0`))
		const initial = await dump("f64", start)
		// Each step's CPU parameters, carbonmod's counter carried along.
		const { step: first, carbonStep, calendar } = stepCalendar(initial)
		const steps = []
		let counter = carbonStep
		for (let k = 0; k < Math.max(...checks) - start; k++) {
			const values = modules.STEPPER.values({ step: first + k, carbonStep: counter, calendar })
			steps.push(Object.fromEntries(Object.entries(values.fields).map(([name, field]) => [name, Array.from(field)])))
			counter = values.carbonStep
		}
		const started = performance.now()
		const gpu = await runOnGpu({
			page,
			truncation,
			state: Object.fromEntries([...NEEDED].filter((name) => dumped(initial, name)).map((name) => [name, dumped(initial, name)])),
			tables: await tablesInputs({ modules, probeRoot, truncation, dump: initial }),
			phases: [{ constants: stepperConstants(initial), tables: {}, steps, reads: checks.map((check) => ({ after: check - start, label: check })) }],
		})
		const seconds = (performance.now() - started) / 1000
		for (const check of checks) {
			const result = judge({ gpu: gpu.results[check], f64: await dump("f64", check), f32: await dump("f32", check), dumped })
			report.cases.push({ truncation, start, steps: check - start, ...result, dispatchesPerStep: gpu.dispatches[0], seconds })
			console.log(`T${truncation} ${String(check - start).padStart(2)} steps ${result.pass ? "pass" : "FAIL"}  ${summary(result.fields)}`)
		}
	}
	report.errors = errors
	report.chrome = browser.version()
} finally {
	await fs.writeFile(path.join(output, "trajectory.json"), JSON.stringify(report, null, 2))
	await browser.close()
	await server.close()
}
