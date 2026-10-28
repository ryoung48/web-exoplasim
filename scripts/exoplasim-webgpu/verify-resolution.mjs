import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const truncation = Number(process.argv[2] ?? 63)
const output = path.resolve(`stats/exoplasim-webgpu/t${truncation}`)
await fs.mkdir(output, { recursive: true })
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
try {
	const page = await browser.newPage()
	await page.goto(server.resolvedUrls.local[0])
	const report = await page.evaluate(async (truncation) => {
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
		const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
		const { GCM_CHECKPOINT } = await import("/src/model/climate/gcm/checkpoint/index.ts")
		const grid = GCM_GRID.forTruncation(truncation)
		const resolutions = await GCM_RUNNER.resolutions()
		const terrain = { name: "Resolution test continent", width: 4, height: 2, elevationM: new Float32Array([1000, 1000, 0, 0, 1000, 1000, 0, 0]), land: new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]) }
		const rows = []
		const wait = async (predicate) => {
			const until = performance.now() + 180000
			while (!predicate()) {
				if (performance.now() > until) throw new Error("Resolution run timed out")
				await new Promise(resolve => setTimeout(resolve, 20))
			}
		}
		const fingerprint = (snapshot) => {
			let hash = 2166136261
			for (const value of new Uint32Array(snapshot.values.buffer, snapshot.values.byteOffset, snapshot.values.length)) hash = Math.imul(hash ^ value, 16777619)
			return hash >>> 0
		}
		for (const layers of [5, 10]) for (const earthSurfaceClimatology of [false, true]) {
			const config = { ...GCM.DEFAULT_CONFIG, truncation, layers, earthSurfaceClimatology, timestepMinutes: 20 }
			const resolution = resolutions.find(entry => entry.truncation === truncation && entry.layers === layers)
			if (!resolution?.gpu || resolution.latitudes !== grid.latitudes) throw new Error("GPU resolution is missing")
			let run, latest, first, failure, saved
			let paused = false
			let requested = false
			const original = new Map()
			const resumed = new Map()
			const onStatus = ({ status, message }) => { if (status === "failed") failure = message; if (status === "paused") paused = true }
			const base = { engine: "gpu", ranks: null, config, terrain, resolution, publishEvery: 128, onAverages() {}, onDevice() {}, onStatus }
			try {
				run = GCM_RUNNER.start({ ...base, restart: null, averager: null, startPaused: false,
					onSnapshot(snapshot) { latest = snapshot; first ??= snapshot.step; original.set(snapshot.step, fingerprint(snapshot)); if (!requested && snapshot.step >= first + 128) { requested = true; run.checkpoint() } },
					onCheckpoint(checkpoint) {
						const meta = { format: GCM_CHECKPOINT.FORMATS.gpu, config, precisionBytes: 4, date: latest.date, step: latest.step }
						const encoded = GCM_CHECKPOINT.encode({ meta, terrain, restart: checkpoint.restart, diagnostics: { snapshot: latest, averager: checkpoint.averager } })
						saved = GCM_CHECKPOINT.decode(encoded)
					},
				})
				await wait(() => failure || saved && latest.step >= saved.meta.step + 512)
				if (failure) throw new Error(failure)
				if (latest.values.length !== grid.points * GCM_FIELDS.fieldCount(layers) || !latest.values.every(Number.isFinite)) throw new Error("Invalid T63 snapshot")
				const minimum = GCM_FIELDS.field({ snapshot: latest, field: "airTemperatureMin" })
				const maximum = GCM_FIELDS.field({ snapshot: latest, field: "airTemperatureMax" })
				if (!GCM_FIELDS.field({ snapshot: latest, field: "airTemperature" }).every((value, index) => minimum[index] <= value && value <= maximum[index])) throw new Error("Invalid extrema")
				run.stop()
				run = GCM_RUNNER.start({ ...base, restart: saved.restart, averager: saved.diagnostics.averager, startPaused: true, onSnapshot(snapshot) { latest = snapshot; resumed.set(snapshot.step, fingerprint(snapshot)) }, onCheckpoint() {} })
				await wait(() => failure || paused)
				if (failure) throw new Error(failure)
				run.resume()
				await wait(() => failure || resumed.size >= 4)
				if (failure) throw new Error(failure)
				const common = Array.from(resumed).filter(([step]) => original.has(step))
				if (common.length < 3 || !common.every(([step, hash]) => hash === original.get(step))) throw new Error("Checkpoint continuation differs")
				rows.push({ layers, earthSurfaceClimatology, timestepMinutes: config.timestepMinutes, finite: true, checkpointIdentical: true, comparedSteps: common.map(([step]) => step), points: grid.points })
				console.log(`T${truncation} L${layers} climatologies=${earthSurfaceClimatology} passed`)
			} finally { run?.stop() }
		}
		return { truncation, rows }
	}, truncation)
	await page.goto(new URL("gcm", server.resolvedUrls.local[0]).href)
	const button = page.getByRole("button", { name: new RegExp(`^T${truncation}(?: |$)`) })
	await button.click()
	assert.match(await button.getAttribute("class"), /\bbg-white\b/)
	assert.match(await page.getByRole("button", { name: "20", exact: true }).getAttribute("class"), /\bbg-white\b/)
	assert.equal(await page.getByRole("checkbox", { name: "Earth surface climatology", exact: true }).isChecked(), false)
	await page.getByRole("button", { name: "CPU", exact: true }).click()
	assert.equal(await button.count(), 0)
	report.ui = { gpuSelectable: true, cpuHidden: true }
	await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
} finally {
	await browser.close()
	await server.close()
}
