import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { chromium } from "playwright"
import { createServer } from "vite"

const output = path.resolve("stats/exoplasim-webgpu/storm")
await fs.mkdir(output, { recursive: true })
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
try {
	const page = await browser.newPage()
	const errors = []
	page.on("pageerror", error => { errors.push(error.message); console.error(error.message) })
	page.on("console", message => console.log(message.text()))
	await page.goto(server.resolvedUrls.local[0])
	const result = await page.evaluate(async () => {
		const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
		const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
		const { SETUP } = await import("/src/model/climate/gcm/setup/index.ts")
		const { STORM } = await import("/src/model/climate/gcm/physics/storm/index.ts")
		const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
		const { KERNEL } = await import("/src/model/climate/gcm/kernel/index.ts")
		const { SNAPSHOT } = await import("/src/model/climate/gcm/snapshot/index.ts")
		const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
		const { GCM_NAMELIST } = await import("/src/model/climate/gcm/namelist/index.ts")
		const { GCM_BOUNDARY } = await import("/src/model/climate/gcm/boundary/index.ts")
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { device, adapter } = await GCM_DEVICE.request({ storageBytes: 0, onLost: message => { if (message !== "Device was destroyed.") throw new Error(message) } })
		console.log("Device ready")
		device.addEventListener("uncapturederror", event => { throw new Error(event.error.message) })
		const { files } = await (await fetch("/gcm/t21/inputs.json")).json()
		const names = ["capen", "lnb", "mpoti", "chim", "laav", "venti", "vrmpi", "gpi", "shear"]
		const fieldIds = ["cape", "neutralBuoyancyPressure", "potentialIntensity", "entropyDeficit", "absoluteVorticity", "ventilationIndex", "ventilationReducedIntensity", "genesisPotentialIndex", "windShear"]
		console.log("Inputs fetched")
		const fixtures = []
		const timings = []
		for (const layers of [5, 10]) {
			const config = { ...GCM.DEFAULT_CONFIG, layers, stormclim: true }
			const grid = GCM_GRID.forTruncation(21)
			const namelists = { ...files, ...GCM_BOUNDARY.files({ grid, landFraction: new Float64Array(grid.points), geopotential: new Float64Array(grid.points) }) }
			for (const [name, values] of Object.entries(GCM_NAMELIST.edits(config))) namelists[name] = GCM_NAMELIST.apply({ text: files[name], values })
			const request = { truncation: 21, levels: layers, namelists }
			console.log("Setup state", layers)
			const initial = SETUP.state({ ...request, clock: 0 })
			console.log("Schedule", layers)
			const schedule = SETUP.schedule({ request, state: initial })
			if (schedule.main.stepper.storm.NSTORMDIAG !== 1) throw new Error("Toggle did not reach GPU setup")
			console.log("Context", layers)
			const context = STEPPER.context({ device, dimensions: { truncation: 21, latitudes: 32, longitudes: 64, levels: layers }, tables: schedule.tables })
			const write = ({ name, values }) => LAYOUT.write({ device, buffer: context.stateBuffer, layout: context.state, name, values: Float32Array.from(values) })
			const points = 2048
			for (const rd of [287, 189]) {
				const rows = []
				for (const climate of ["tropical", "warm", "cold", "hot", "dry", "stable", "thin", "humid", "cold-profile", "reversed-vorticity", "zero-shear"]) {
					const sigma = Array.from(schedule.tables.dynamics.sigma)
					const msl = climate === "thin" ? 500 : 1000
					const sst = climate === "cold" ? 270 : climate === "hot" ? 330 : climate === "warm" ? 300 : 305
					const t = sigma.map(s => climate === "stable" ? 290 : climate === "cold-profile" ? 95 + 150 * s : 195 + 108 * Math.sqrt(s))
					const r = t.map((temp, l) => {
						const e = 6.112 * Math.exp(17.67 * (temp - 273.15) / (temp - 29.65))
						return climate === "dry" ? 0 : rd / 461.5 * e / (msl * sigma[l] - e) * (climate === "humid" ? 0.98 : 0.7)
					})
					const surfaceE = 6.112 * Math.exp(17.67 * (sst - 273.15) / (sst - 29.65))
					r.push(climate === "dry" ? 0 : 0.8 * (rd / 461.5) * surfaceE / (msl - surfaceE))
					rows.push({ layers, rd, climate, sigma, msl, sst, omega: schedule.main.stepper.storm.OMEGA, t, r, u: sigma.map(s => climate === "zero-shear" ? 5 : 3 + 20 * (1 - s)), v: sigma.map(() => 4), z: sigma.map(() => climate === "reversed-vorticity" ? -1.2 : 1.2) })
				}
				const profile = key => Array.from({ length: context.state.slots[key === "t" ? "dt" : key === "r" ? "dq" : key === "u" ? "du" : key === "v" ? "dv" : "gz"].floats }, (_, i) => {
					const row = rows[(i % points) % rows.length]
					const l = Math.floor(i / points)
					return key === "t" && l === layers ? row.sst : row[key][l] ?? 0
				})
				for (const [key, name] of Object.entries({ t: "dt", r: "dq", u: "du", v: "dv", z: "gz" })) write({ name, values: profile(key) })
				write({ name: "dp", values: Array.from({ length: points }, (_, i) => rows[i % rows.length].msl * 100) })
				console.log(`Compiling storm ${layers}L RD=${rd}`)
				const kernels = await STORM.kernels({ context, constants: { ...schedule.main.stepper.storm, RD: rd } })
				console.log("Compiled")
				const pack = await SNAPSHOT.kernel({ context, sigma: schedule.tables.dynamics.sigma, humidity: schedule.main.stepper.precipitation })
				write({ name: "snapshot_step", values: [4, 32, 1] })
				const encoder = device.createCommandEncoder()
				const pass = encoder.beginComputePass()
				STEPPER.encode({ pass, context, kernels: [...kernels, pack] })
				pass.end()
				device.queue.submit([encoder.finish()])
				console.log("Submitted")
				const actual = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names: [...names, "snapshot"] })
				for (const [i, row] of rows.entries()) {
					const gpu = names.map(name => actual[name][i])
					const snapshot = { layers, step: 4, date: { year: 0, month: 1, day: 1, hour: 0, minute: 0 }, values: actual.snapshot }
					if (!fieldIds.every((field, k) => GCM_FIELDS.field({ snapshot, field })[i] === gpu[k])) throw new Error("Storm snapshot field packing mismatch")
					fixtures.push({ ...row, gpu })
				}
			}
			const disabled = await STORM.kernels({ context, constants: { ...schedule.main.stepper.storm, NSTORMDIAG: 0 } })
			if (disabled.length !== 0) throw new Error("Disabled storm diagnostics dispatch work")
			// Isolated diagnostics dispatch cost on the same mixed columns.
			const kernels = await STORM.kernels({ context, constants: schedule.main.stepper.storm })
			for (let round = 0; round < 4; round++) {
				const encoder = device.createCommandEncoder()
				const pass = encoder.beginComputePass()
				for (let k = 0; k < 48; k++) STEPPER.encode({ pass, context, kernels })
				pass.end()
				await device.queue.onSubmittedWorkDone()
				const start = performance.now()
				device.queue.submit([encoder.finish()])
				await device.queue.onSubmittedWorkDone()
				if (round > 0) timings.push({ layers, millisecondsPerStep: (performance.now() - start) / 48 })
			}
			context.stateBuffer.destroy()
			context.tableBuffer.destroy()
		}
		device.destroy()
		return { fixtures, timings, adapter: `${adapter.vendor} ${adapter.architecture}` }
	})
	if (process.argv.includes("--runs")) result.fixtures.push(...JSON.parse(await fs.readFile(path.join(output, "runs.json"), "utf8")).fixtures)
	await fs.writeFile(path.join(output, "fixtures.json"), JSON.stringify(result.fixtures, null, 2))
	const wslPath = value => `/mnt/${value[0].toLowerCase()}${value.slice(2).replaceAll("\\", "/")}`
	const native = await promisify(execFile)("wsl", ["-d", "Ubuntu", "--", "python3", wslPath(path.resolve("scripts/exoplasim-webgpu/storm-reference.py")), wslPath(path.join(output, "fixtures.json"))])
	console.log(native.stdout)
	const reference = JSON.parse(await fs.readFile(path.join(output, "native.json"), "utf8"))
	const absolute = [5, 1, 0.2, 0.005, 1e-9, 0.005, 0.005, 0.005, 1e-4]
	const differences = reference.map(row => ({ layers: row.layers, climate: row.climate, rd: row.rd, errors: row.gpu.map((value, i) => Math.abs(value - row.expected[i])) }))
	const report = { adapter: result.adapter, cases: reference.length, timings: result.timings, differences, errors }
	await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2))
	for (const row of reference) row.gpu.forEach((value, i) => assert.ok(Number.isFinite(value) && Math.abs(value - row.expected[i]) <= absolute[i] + 0.005 * Math.abs(row.expected[i]), `${row.layers}L ${row.climate} RD=${row.rd} field ${i}: GPU=${value} native=${row.expected[i]}`))
	assert.deepEqual(errors, [])
	console.log(JSON.stringify({ cases: report.cases, adapter: report.adapter, timings: report.timings }, null, 2))
} finally {
	await browser.close()
	await server.close()
}
