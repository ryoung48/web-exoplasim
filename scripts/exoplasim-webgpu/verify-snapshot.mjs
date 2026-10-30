import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const output = path.resolve("stats/exoplasim-webgpu/snapshot")
await fs.mkdir(output, { recursive: true })
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
try {
	const page = await browser.newPage()
	await page.goto(server.resolvedUrls.local[0])
	const results = await page.evaluate(async () => {
		const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
		const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
		const { SETUP } = await import("/src/model/climate/gcm/setup/index.ts")
		const { SNAPSHOT } = await import("/src/model/climate/gcm/snapshot/index.ts")
		const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
		const { KERNEL } = await import("/src/model/climate/gcm/kernel/index.ts")
		const { RESTART } = await import("/src/model/climate/gcm/checkpoint/restart/index.ts")
		const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
		const errors = []
		const { device } = await GCM_DEVICE.request({ storageBytes: 0, onLost: (message) => errors.push(message) })
		device.addEventListener("uncapturederror", (event) => errors.push(event.error.message))
		const { files } = await (await fetch("/gcm/t21/inputs.json")).json()
		const temperatures = [281, 295, 284, 283, 291, 279, 283, 285, 286, 300, 280, 290]
		const expected = [
			[281, 295, 14, 0, 0],
			[281, 295, 14, 14, 1],
			[279, 291, 12, 12, 1],
			[280, 300, 20, 20, 1],
		]
		const rows = []
		for (const layers of [5, 10]) {
			const request = { truncation: 21, levels: layers, namelists: files }
			const initial = SETUP.state({ ...request, clock: 0 })
			const schedule = SETUP.schedule({ request, state: initial })
			const dimensions = { truncation: 21, latitudes: 32, longitudes: 64, levels: layers }
			const context = STEPPER.context({ device, dimensions, tables: schedule.tables })
			const kernel = await SNAPSHOT.kernel({ context, sigma: schedule.tables.dynamics.sigma, humidity: schedule.main.stepper.precipitation })
			const write = ({ name, values }) => LAYOUT.write({ device, buffer: context.stateBuffer, layout: context.state, name, values: Float32Array.from(values) })
			const fill = ({ name, value }) => write({ name, values: new Float32Array(context.state.slots[name].floats).fill(value) })
			for (const [name, value] of Object.entries({ dt: 288, du: 3, dv: 4, dcc: 0.5, dq: 0.005, dp: 100000, devap: -2, drunoff: 3, dforest: 0.25, dlai: 2, dnpp: 0.00000003125, gmu0: 0.5, dprs: 4, dsmelt: 5, diced: 6, dglac: 0.75, dswfl: 100, dlwfl: -50, dshfl: 10, dlhfl: 20 })) fill({ name, value })
			const runStep = async (step) => {
				const surface = new Float32Array(2048).fill(temperatures[step - 1])
				context.device.queue.writeBuffer(context.stateBuffer, (context.state.slots.dt.offset + layers * 2048) * 4, surface)
				write({ name: "snapshot_step", values: [step, 4, step % 3 === 0 ? 1 : 0] })
				const encoder = device.createCommandEncoder()
				const pass = encoder.beginComputePass()
				KERNEL.dispatch({ pass, context, kernel })
				pass.end()
				device.queue.submit([encoder.finish()])
				const values = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names: ["snapshot"] })
				return { layers, step, date: { year: 1, month: 1, day: 1, hour: 0, minute: 0 }, values: values.snapshot }
			}
			let saved
			let last
			for (let step = 1; step <= 12; step++) {
				last = await runStep(step)
				if (step % 3 === 0) {
					const actual = ["surfaceTemperatureMin", "surfaceTemperatureMax", "diurnalTemperatureRange", "dailyTemperatureRangeSum", "dailyTemperatureRangeDays"].map((field) => GCM_FIELDS.field({ snapshot: last, field })[0])
					if (JSON.stringify(actual) !== JSON.stringify(expected[step / 3 - 1])) throw new Error(`Extrema/DTR at step ${step}: ${actual}`)
				}
				if (step === 6) {
					const values = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: context.state, names: Object.keys(context.state.slots) })
					saved = RESTART.encode({ layout: context.state, values, step: 7, carbonStep: 0 })
				}
			}
			const expectedFields = { evaporation: 2, runoff: 3, forestCover: 0.25, leafAreaIndex: 2, netPrimaryProduction: 0.00000003125, solarZenithCosine: 0.5, snowfall: 4, snowmelt: 5, seaIceThickness: 6, glacierCover: 0.75, surfaceShortwave: 100, surfaceLongwave: -50, sensibleHeatFlux: 10, latentHeatFlux: 20, convectivePrecipitation: 0, largeScalePrecipitation: 0, toaShortwave: 100, toaLongwave: -50 }
			for (let level = 1; level <= layers; level++) Object.assign(expectedFields, { [`layerTemperature${level}`]: 288, [`layerWindU${level}`]: 3, [`layerWindV${level}`]: 4, [`layerCloud${level}`]: 0.5 })
			for (const [field, value] of Object.entries(expectedFields)) if (!GCM_FIELDS.field({ snapshot: last, field }).every((actual) => actual === Math.fround(value))) throw new Error(`Packing ${field} failed`)
			if (Math.abs(GCM_FIELDS.values({ snapshot: last, mode: "netPrimaryProduction" })[0] - 2.7) > 1e-6) throw new Error("NPP display units differ")
			const humidity = schedule.main.stepper.precipitation
			let qsat = humidity.rdbrv * humidity.ra1 * Math.exp(humidity.ra2 * (288 - humidity.tmelt) / (288 - humidity.ra4)) / (100000 * schedule.tables.dynamics.sigma.at(-1))
			qsat = Math.min(qsat, humidity.rdbrv)
			qsat /= 1 - (1 / humidity.rdbrv - 1) * qsat
			const actualRh = GCM_FIELDS.values({ snapshot: last, mode: "relativeHumidity" })[0]
			if (Math.abs(actualRh - 0.005 / qsat * 100) > 0.001) throw new Error(`Pasta relative humidity differs: ${actualRh}`)
			const restored = RESTART.decode({ buffer: saved, layout: context.state })
			for (const [name, values] of Object.entries(restored.values)) write({ name, values })
			let resumed
			for (let step = restored.step; step <= 12; step++) resumed = await runStep(step)
			if (!last.values.every((value, index) => value === resumed.values[index])) throw new Error("Restart changed diagnostic state")
			fill({ name: "snapshot_tracking", value: 0 })
			for (let step = 2; step <= 6; step++) resumed = await runStep(step)
			if (GCM_FIELDS.field({ snapshot: resumed, field: "dailyTemperatureRangeDays" })[0] !== 1) throw new Error("Lost native partial output window")
			rows.push({ layers, fields: GCM_FIELDS.fieldCount(layers), packing: true, extrema: true, dailyRanges: true, restart: true, nativePartialWindow: true, humidity: actualRh })
			context.stateBuffer.destroy()
			context.tableBuffer.destroy()
		}

        const { GCM } = await import("/src/model/climate/gcm/index.ts")
        const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
        const resolutions = await GCM_RUNNER.resolutions()
        const terrain = { name: "GPU integration continent", width: 4, height: 2, elevationM: new Float32Array([1000, 1000, 0, 0, 1000, 1000, 0, 0]), land: new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]) }
        const runnerRows = []
        for (const truncation of [21, 42]) for (const layers of [5, 10]) {
            const config = { ...GCM.DEFAULT_CONFIG, truncation, layers, earthSurfaceClimatology: false, vegetation: truncation === 21 ? (layers === 5 ? 1 : 2) : 0, gravityMs2: 12, radiusEarth: 1.2, landAlbedo: 0.3, oceanAlbedo: 0.1, soilWaterCapacityM: 0.25, soilHeatCapacity: 3000000, soilDepthScale: 2 }
            const resolution = resolutions.find((entry) => entry.truncation === truncation && entry.layers === layers)
            let run
            let first
            try {
                const snapshot = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => { run?.stop(); reject(new Error("Custom-terrain GPU run timed out")) }, 60000)
                    run = GCM_RUNNER.start({ engine: "gpu", ranks: null, config, terrain, resolution, publishEvery: 4, restart: null, averager: null, startPaused: false,
                        onSnapshot(snapshot) {
                            first ??= snapshot.step
                            if (snapshot.step < first + 48) return
                            clearTimeout(timer)
                            resolve(snapshot)
                        },
                        onAverages() {}, onDevice() {}, onCheckpoint() {},
                        onStatus({ status, message }) { if (status === "failed") { clearTimeout(timer); reject(new Error(message)) } },
                    })
                })
                const mask = GCM_FIELDS.field({ snapshot, field: "landFraction" })
                if (snapshot.layers !== layers || !snapshot.values.every(Number.isFinite) || !mask.some((value) => value === 0) || !mask.some((value) => value === 1)) throw new Error("Custom terrain or snapshot layout was lost")
                const npp = GCM_FIELDS.field({ snapshot, field: "netPrimaryProduction" })
                const czen = GCM_FIELDS.field({ snapshot, field: "solarZenithCosine" })
                if (!czen.every((value) => value >= 0 && value <= 1) || !czen.some((value) => value > 0)) throw new Error("GPU illumination is invalid")
                if (config.vegetation === 0 ? !npp.every((value) => value === 0) : !npp.some((value) => value > 0)) throw new Error("GPU vegetation production was not retained")
                const minimum = GCM_FIELDS.field({ snapshot, field: "surfaceTemperatureMin" })
                const maximum = GCM_FIELDS.field({ snapshot, field: "surfaceTemperatureMax" })
                if (!minimum.every((value, index) => value <= maximum[index])) throw new Error("GPU window extrema are reversed")
                runnerRows.push({ truncation, layers, steps: snapshot.step - first, customTerrain: true, overrides: true, finite: true, extrema: true, vegetation: config.vegetation, nppMax: Math.max(...npp), czenMax: Math.max(...czen) })
            } finally { run?.stop() }
        }
        device.destroy()
        return { rows, runnerRows, errors }
	})
	await fs.writeFile(path.join(output, "snapshot.json"), JSON.stringify(results, null, 2))
	console.log(JSON.stringify(results, null, 2))
	assert.equal(results.errors.length, 0)
} finally {
	await browser.close()
	await server.close()
}
