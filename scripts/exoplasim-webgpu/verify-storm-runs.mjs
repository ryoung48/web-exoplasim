import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const output = path.resolve("stats/exoplasim-webgpu/storm")
await fs.mkdir(output, { recursive: true })
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
try {
	const page = await browser.newPage()
	await page.goto(server.resolvedUrls.local[0])
	const report = await page.evaluate(async ({ engines }) => {
		const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
		const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
		const { SETUP } = await import("/src/model/climate/gcm/setup/index.ts")
		const { SNAPSHOT } = await import("/src/model/climate/gcm/snapshot/index.ts")
		const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
		const { RESTART } = await import("/src/model/climate/gcm/checkpoint/restart/index.ts")
		const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
		const { GCM_NAMELIST } = await import("/src/model/climate/gcm/namelist/index.ts")
		const { GCM_BOUNDARY } = await import("/src/model/climate/gcm/boundary/index.ts")
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
		const errors = []
		const { device, timestamps, adapter } = await GCM_DEVICE.request({ storageBytes: 0, onLost: message => { if (message !== "Device was destroyed.") errors.push(message) } })
		if (!timestamps) throw new Error("This benchmark requires GPU timestamps")
		const rows = []
		const fixtures = []
		const terrain = { name: "Storm test continent", width: 4, height: 2, elevationM: new Float32Array([1000, 1000, 0, 0, 1000, 1000, 0, 0]), land: new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]) }
		for (const truncation of [21, 42, 63]) for (const layers of [5, 10]) {
			const grid = GCM_GRID.forTruncation(truncation)
			const config = { ...GCM.DEFAULT_CONFIG, truncation, layers, timestepMinutes: truncation === 63 ? 20 : 45, stormclim: true }
			const { files } = await (await fetch(`/gcm/t${truncation}/namelists.json`)).json()
			Object.assign(files, GCM_BOUNDARY.files(GCM_BOUNDARY.fromTerrain({ grid, terrain, gravityMs2: config.gravityMs2 })))
			for (const [name, values] of Object.entries(GCM_NAMELIST.edits(config))) files[name] = GCM_NAMELIST.apply({ text: files[name], values })
			const request = { truncation, levels: layers, namelists: files }
			const initial = SETUP.state({ ...request, clock: 0 })
			const schedule = SETUP.schedule({ request, state: initial })
			const context = STEPPER.context({ device, dimensions: { truncation, latitudes: grid.latitudes, longitudes: grid.longitudes, levels: layers }, tables: schedule.tables })
			const write = ({ name, values }) => LAYOUT.write({ device, buffer: context.stateBuffer, layout: context.state, name, values: Float32Array.from(values) })
			const restore = values => { for (const [name, value] of Object.entries(values)) if (context.state.slots[name]) write({ name, values: value }) }
			restore(initial.fields)
			let carbonStep = 0
			for (const phase of schedule.startup) {
				LAYOUT.write({ device, buffer: context.tableBuffer, layout: context.tables, name: "bm1", values: Float32Array.from(phase.bm1) })
				const values = STEPPER.values({ step: schedule.startStep, carbonStep, calendar: schedule.calendar })
				carbonStep = values.carbonStep
				restore(values.fields)
				const kernels = await STEPPER.kernels({ context, constants: phase.stepper })
				const encoder = device.createCommandEncoder()
				const pass = encoder.beginComputePass()
				STEPPER.encode({ context, pass, kernels })
				pass.end()
				device.queue.submit([encoder.finish()])
			}
			LAYOUT.write({ device, buffer: context.tableBuffer, layout: context.tables, name: "bm1", values: Float32Array.from(schedule.main.bm1) })
			const enabled = await STEPPER.kernels({ context, constants: schedule.main.stepper })
			const disabled = await STEPPER.kernels({ context, constants: { ...schedule.main.stepper, storm: { ...schedule.main.stepper.storm, NSTORMDIAG: 0 } } })
			const pack = await SNAPSHOT.kernel({ context, sigma: schedule.tables.dynamics.sigma, humidity: schedule.main.stepper.precipitation })
			const snapshotBytes = context.state.slots.snapshot.floats * 4
			const staging = device.createBuffer({ size: 16 + 16 * snapshotBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
			const timing = { querySet: device.createQuerySet({ type: "timestamp", count: 2 }), resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) }
			const params = device.createBuffer({ size: 48 * 64 * 4, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
			const steps = []
			for (let k = 0; k < 48; k++) {
				const values = STEPPER.values({ step: schedule.startStep + k, carbonStep, calendar: schedule.calendar })
				carbonStep = values.carbonStep
				steps.push(values.fields)
			}
			const names = Object.keys(context.state.slots)
			const base = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names })
			const times = { enabled: [], disabled: [] }
			const last = {}
			for (let round = 0; round < 3; round++) for (const mode of ["disabled", "enabled"]) {
				restore(base)
				device.queue.submit([STEPPER.batch({ context, kernels: mode === "enabled" ? enabled : disabled, pack, params, steps, firstStep: schedule.startStep, publishEvery: 4, staging, timing })])
				await staging.mapAsync(GPUMapMode.READ)
				const clock = new BigUint64Array(staging.getMappedRange(), 0, 2)
				times[mode].push(Number(clock[1] - clock[0]) / 1e6 / 48)
				staging.unmap()
				last[mode] = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names })
			}
			for (const name of names) {
				if (["capen", "lnb", "mpoti", "chim", "laav", "venti", "vrmpi", "gpi", "shear", "snapshot"].includes(name)) continue
				if (!last.enabled[name].every((value, i) => value === last.disabled[name][i])) throw new Error(`Storm diagnostics changed ${name}`)
			}
			const saved = RESTART.encode({ layout: context.state, values: last.enabled, step: schedule.startStep + 48, carbonStep })
			const decoded = RESTART.decode({ layout: context.state, buffer: saved })
			for (const name of names) if (!last.enabled[name].every((value, i) => value === decoded.values[name][i])) throw new Error(`Storm restart lost ${name}`)
			// Save actual dimensionalized model columns for the same native reference checker.
			for (const h of [0, Math.floor(grid.points / 4), Math.floor(grid.points / 2), grid.points - 1]) {
				const column = name => Array.from({ length: layers }, (_, l) => last.enabled[name][l * grid.points + h])
				fixtures.push({ layers, rd: schedule.main.stepper.storm.RD, omega: schedule.main.stepper.storm.OMEGA, climate: `run-t${truncation}-h${h}`, sigma: Array.from(schedule.tables.dynamics.sigma), sst: last.enabled.dt[layers * grid.points + h], msl: last.enabled.dp[h] * 0.01, t: column("dt"), r: [...column("dq"), last.enabled.dq[layers * grid.points + h]], u: column("du"), v: column("dv"), z: column("gz"), gpu: ["capen", "lnb", "mpoti", "chim", "laav", "venti", "vrmpi", "gpi", "shear"].map(name => last.enabled[name][h]) })
			}
			rows.push({ truncation, layers, steps: 48, times, prognosticStateUnchanged: true, restartExact: true })
			for (const buffer of [staging, timing.resolve, params, context.stateBuffer, context.tableBuffer]) buffer.destroy()
			timing.querySet.destroy()
		}
		device.destroy()
		const resolutions = await GCM_RUNNER.resolutions()
		const runners = []
		for (const engine of engines) for (const truncation of engine === "gpu" ? [21, 42, 63] : [21, 42]) for (const layers of [5, 10]) for (const ranks of engine === "cpu" ? [2, 4, 8] : [null]) {
			const config = { ...GCM.DEFAULT_CONFIG, truncation, layers, timestepMinutes: truncation === 63 ? 20 : 45, stormclim: true }
			const resolution = resolutions.find(entry => entry.truncation === truncation && entry.layers === layers)
			let run
			try {
				const snapshot = await new Promise((resolve, reject) => {
					const timer = setTimeout(() => { run?.stop(); reject(new Error(`${engine} runner timed out`)) }, 90000)
					run = GCM_RUNNER.start({ previousConfig: null, targeting: null, onTargeting() {}, engine, ranks, config, terrain, resolution, publishEvery: 4, restart: null, averager: null, startPaused: false,
						onSnapshot(snapshot) { clearTimeout(timer); run.pause(); resolve(snapshot) },
						onAverages() {}, onDevice() {}, onCheckpoint() {},
						onStatus({ status, message }) { if (status === "failed") { clearTimeout(timer); reject(new Error(message)) } },
					})
				})
				if (!snapshot.values.every(Number.isFinite)) throw new Error(`${engine} nonfinite snapshot`)
				const storm = GCM_FIELDS.field({ snapshot, field: "potentialIntensity" })
				if (!storm.some(value => value !== 0)) throw new Error(`${engine} did not enable diagnostics`)
				runners.push({ engine, truncation, ranks, layers, fields: GCM_FIELDS.fieldCount(layers), finite: true, enabled: true })
			} finally { run?.stop() }
		}
		return { adapter: `${adapter.vendor} ${adapter.architecture}`, rows, fixtures, runners, errors }
	}, { engines: process.argv.includes("--gpu-only") ? ["gpu"] : ["gpu", "cpu"] })
	await fs.writeFile(path.join(output, "runs.json"), JSON.stringify(report, null, 2))
	assert.deepEqual(report.errors, [])
	console.log(JSON.stringify({ rows: report.rows, runners: report.runners }, null, 2))
} finally {
	await browser.close()
	await server.close()
}
