import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "vite"
import { dumped, loadModules, readInputs } from "./model-inputs.mjs"
import { readProbe } from "./probe.mjs"
import { judge, openPage, runOnGpu, summary } from "./trajectory.mjs"

// A fresh start from SETUP alone: the page's namelists and .sra files give
// the initial state, constants and tables; the GPU runs master's three
// start-up steps (each with its timestep's bm1) and then the main loop.
// The f32 build starts from the f64 state after prolog (kits3-a0, rounded
// once); after each start-up step and after 2 and K main steps every field
// must be within V4's gate of the f64 run.
const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const inputsRoot = path.resolve(process.argv[3] ?? "../../../stats/exoplasim-reference/inputs")
const output = path.resolve("stats/exoplasim-webgpu/startup")
await fs.mkdir(output, { recursive: true })
const KITS = 3
const CHECKS = [2, 32]
const plain = (record) => Object.fromEntries(Object.entries(record).map(([name, values]) => [name, Array.from(values)]))

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const modules = await loadModules(server)
const { SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/setup/index.ts"))
const NEEDED = new Set(modules.STEPPER.fields(10).map((field) => field.name))
const { browser, page, errors } = await openPage(server)
const report = { cases: [] }
try {
	for (const truncation of [21, 42]) {
		const request = { truncation, levels: 10, namelists: await readInputs(path.join(inputsRoot, `earth-t${truncation}`)) }
		const state = SETUP.state({ ...request, clock: 0 })
		const setup = (kits) => SETUP.constants({ ...request, meanOrography: state.so[0], kits })
		const bm1 = (kits) => Array.from(SETUP.dynamicsTables({ request, kits, state }).bm1)
		const main = setup(0)
		// nstep stays at the start step through the start-up steps;
		// carbonmod's counter runs from 0 through all of them.
		let counter = 0
		const stepValues = (step) => {
			const values = modules.STEPPER.values({ step, carbonStep: counter, calendar: main.calendar })
			counter = values.carbonStep
			return plain(values.fields)
		}
		const start = main.pumamod.n_start_step
		const phases = []
		for (let kits = KITS; kits >= 1; kits--)
			phases.push({ constants: setup(kits).stepper, tables: { bm1: bm1(kits) }, steps: [stepValues(start)], reads: [{ after: 1, label: `kits${kits}-a4` }] })
		phases.push({
			constants: main.stepper,
			tables: { bm1: bm1(0) },
			steps: Array.from({ length: Math.max(...CHECKS) }, (_, k) => stepValues(start + k)),
			reads: CHECKS.map((check) => ({ after: check, label: `${check}-a0` })),
		})
		const started = performance.now()
		const gpu = await runOnGpu({
			page,
			truncation,
			state: plain(Object.fromEntries(Object.entries(state.fields).filter(([name]) => NEEDED.has(name)))),
			tables: { ...main.tables, dynamics: plain(SETUP.dynamicsTables({ request, kits: KITS, state })) },
			phases,
		})
		const seconds = (performance.now() - started) / 1000
		for (const label of Object.keys(gpu.results)) {
			const dump = (precision) => readProbe(path.join(probeRoot, `startup-${precision}-t${truncation}`, `probe-${label}`))
			const result = judge({ gpu: gpu.results[label], f64: await dump("f64"), f32: await dump("f32"), dumped })
			report.cases.push({ truncation, point: label, ...result, dispatchesPerStep: gpu.dispatches, seconds })
			console.log(`T${truncation} ${label.padStart(8)} ${result.pass ? "pass" : "FAIL"}  ${summary(result.fields)}`)
		}
	}
	report.errors = errors
	report.chrome = browser.version()
	if (errors.length) console.log(`page errors: ${errors.join(" | ")}`)
} finally {
	await fs.writeFile(path.join(output, "startup.json"), JSON.stringify(report, null, 2))
	await browser.close()
	await server.close()
}
