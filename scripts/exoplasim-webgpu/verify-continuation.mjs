import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const output = path.resolve("stats/exoplasim-continuation")
await fs.mkdir(output, { recursive: true })
const server = await createServer({ server: { port: 5196, host: "127.0.0.1" } })
const report = { runs: [], ui: [] }
let browser
try {
	const load = (file) => server.ssrLoadModule(path.resolve(file))
	const { GCM } = await load("src/model/climate/gcm/index.ts")
	const { GCM_CONTINUATION: C } = await load("src/model/climate/gcm/continuation/index.ts")
	const { GCM_ATMOSPHERE: A } = await load("src/model/climate/gcm/atmosphere/index.ts")
	const original = GCM.DEFAULT_CONFIG
	const proposed = { ...original, layers: 5, truncation: 63, timestepMinutes: 5, radiusEarth: 2, gravityMs2: 5, rotationPeriodDays: 4, yearDays: 500, vegetation: 0, earthSurfaceClimatology: false, fluxWm2: 1500, atmosphere: A.setFixedCo2Ppm({ config: original.atmosphere, co2Ppm: 600 }) }
	const restricted = C.restrict({ config: proposed, previousConfig: original })
	for (const key of ["layers", "truncation", "timestepMinutes", "radiusEarth", "gravityMs2", "rotationPeriodDays", "yearDays", "vegetation", "earthSurfaceClimatology"]) assert.equal(restricted[key], original[key], key)
	assert.equal(restricted.fluxWm2, 1500)
	assert.equal(A.resolve(restricted.atmosphere).values.pressureBar, A.resolve(original.atmosphere).values.pressureBar)
	assert.equal(A.resolve(restricted.atmosphere).values.gasConstant, A.resolve(original.atmosphere).values.gasConstant)
	assert(!C.changed({ config: original, previousConfig: original }))
	assert.deepEqual(C.restrict({ config: { ...original, fluxWm2: 1500 }, previousConfig: original }).atmosphere, original.atmosphere)
	await server.listen()
	browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
	const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true })
	page.setDefaultTimeout(60000)
	await page.addInitScript(() => {
		window.continuationStarts = []
		const Original = window.Worker
		window.Worker = class extends Original {
			postMessage(data, options) {
				if (data.type === "start" || (data.type === "load" && data.rank === 0)) window.continuationStarts.push({ config: data.config, previousConfig: data.previousConfig, restart: !!data.restart, months: data.averager?.months.length ?? 0, years: data.averager?.years.length ?? 0 })
				super.postMessage(data, options)
			}
		}
	})
	await page.goto(server.resolvedUrls.local[0])
	for (const [engine, layers] of [["gpu", 5], ["gpu", 10], ["cpu", 5], ["cpu", 10]]) {
		const result = await page.evaluate(async ({ engine, layers }) => {
			const { GCM } = await import("/src/model/climate/gcm/index.ts")
			const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
			const { GCM_ATMOSPHERE } = await import("/src/model/climate/gcm/atmosphere/index.ts")
			const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
			const { RESTART } = await import("/src/model/climate/gcm/checkpoint/restart/index.ts")
			const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
			const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
			const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
			const terrain = { name: "Continuation coast", width: 4, height: 2, elevationM: new Float32Array(8), land: Float32Array.from([1, 1, 0, 0, 1, 1, 0, 0]) }
			const config = { ...GCM.DEFAULT_CONFIG, layers, vegetation: 0, earthSurfaceClimatology: false }
			const resolution = (await GCM_RUNNER.resolutions()).find((entry) => entry.truncation === 21 && entry.layers === layers)
			const execute = ({ config, previousConfig = null, restart = null, until, startPaused = false }) => new Promise((resolve, reject) => {
				let run, latest, requested = false
				const snapshots = []
				const timeout = setTimeout(() => { run?.stop(); reject(new Error(`${engine}/${layers} continuation timeout`)) }, 90000)
				run = GCM_RUNNER.start({ config, previousConfig, restart: restart?.slice(0) ?? null, engine, ranks: 2, terrain, resolution, publishEvery: 4, averager: GCM_AVERAGES.create(), targeting: null, startPaused,
					onDevice() {}, onTargeting() {}, onAverages() {},
					onStatus(update) {
						if (update.status === "failed") { clearTimeout(timeout); run?.stop(); reject(new Error(update.message)) }
						if (startPaused && update.status === "paused") setTimeout(() => run.checkpoint(), 0)
					},
					onSnapshot(snapshot) { snapshots.push(snapshot); latest = snapshot; if (!requested && snapshot.step >= until) { requested = true; run.pause(); run.checkpoint() } },
					onCheckpoint(saved) { clearTimeout(timeout); run.stop(); resolve({ ...saved, latest, snapshots }) },
				})
			})
			const initial = await execute({ config, until: 16 })
			const next = { ...config, fluxWm2: 1500, oceanDepthM: 80, landAlbedo: 0.35, oceanAlbedo: 0.12, snowIceAlbedo: 0.6, soilWaterCapacityM: 0.8, soilDepthScale: 1.2, soilHeatCapacity: 3000000, wetSoil: true, obliquityDeg: 30, eccentricity: 0.05, periapseLongitudeDeg: 120, atmosphere: GCM_ATMOSPHERE.setFixedCo2Ppm({ config: config.atmosphere, co2Ppm: 600 }) }
			const baseline = await execute({ config, restart: initial.restart, until: initial.latest.step + 8 })
			const changed = await execute({ config: next, previousConfig: config, restart: initial.restart, until: initial.latest.step + 8 })
			if (!changed.latest.values.every(Number.isFinite)) throw new Error("Nonfinite changed continuation")
			if (!(changed.latest.step > initial.latest.step)) throw new Error("Model time did not advance")
			const common = changed.snapshots.find((snapshot) => baseline.snapshots.some((other) => other.step === snapshot.step))
			if (!common) throw new Error("No common comparison step")
			const reference = baseline.snapshots.find((snapshot) => snapshot.step === common.step)
			const ir = GCM_FIELDS.field({ snapshot: common, field: "outgoingLongwave" })
			const baseIr = GCM_FIELDS.field({ snapshot: reference, field: "outgoingLongwave" })
			const difference = ir.reduce((sum, value, i) => sum + Math.abs(value - baseIr[i]), 0) / ir.length
			if (!(difference > 1e-5)) throw new Error("Settings had no physical effect")
			const readFields = (buffer) => {
				if (engine === "gpu") {
					const dimensions = { truncation: 21, latitudes: 32, longitudes: 64, levels: layers }
					const layout = LAYOUT.create({ dimensions, fields: STEPPER.fields(layers) })
					return RESTART.decode({ buffer, layout }).values
				}
				const fields = {}
				const view = new DataView(buffer)
				let at = 0
				while (at < view.byteLength) {
					const count = view.getUint32(at, true)
					const name = new TextDecoder().decode(new Uint8Array(buffer, at + 4, count)).trim()
					at += count + 8
					const bytes = view.getUint32(at, true)
					if (["dwmax", "dalbcl"].includes(name)) fields[name] = Array.from({ length: bytes / resolution.cpu.precisionBytes }, (value, i) => resolution.cpu.precisionBytes === 8 ? view.getFloat64(at + 4 + i * 8, true) : view.getFloat32(at + 4 + i * 4, true))
					at += bytes + 8
				}
				return fields
			}
			const fields = readFields(changed.restart)
			for (const [name, expected] of [["dwmax", 0.8], ["dalbcl", 0.35], ...(engine === "gpu" ? [["ymld", 80], ["co2", 600]] : [])]) {
				if (!fields[name]?.every((value) => Math.abs(value - expected) < 1e-5)) throw new Error(`Setting did not survive checkpoint: ${name}`)
			}
			await execute({ config: next, restart: changed.restart, until: changed.latest.step + 4 })
			const resetConfig = { ...next, landAlbedo: null, soilWaterCapacityM: null, oceanDepthM: config.oceanDepthM }
			const reset = await execute({ config: resetConfig, previousConfig: next, restart: changed.restart, until: changed.latest.step + 4 })
			const restored = readFields(reset.restart)
			for (const [name, expected] of [["dalbcl", 0.22], ["dwmax", 0.5], ...(engine === "gpu" ? [["ymld", 50], ["co2", 600]] : [])]) if (!restored[name]?.every((value) => Math.abs(value - expected) < 1e-5)) throw new Error(`Default not restored: ${name}`)
			return { engine, layers, beforeStep: initial.latest.step, afterStep: changed.latest.step, comparedStep: common.step, meanAbsoluteLongwaveDifference: difference, surfaceFieldsRetained: true, savedReloadContinues: true, defaultsRestored: true }
		}, { engine, layers })
		report.runs.push(result)
		console.log(JSON.stringify(result))
	}
	await page.goto(new URL("gcm", server.resolvedUrls.local[0]).href)
	const sidebar = page.locator("#gcm-sidebar")
	for (const engine of ["GPU", "CPU"]) {
		await sidebar.getByRole("button", { name: engine, exact: true }).click()
		await page.getByRole("button", { name: "Start", exact: true }).click()
		await page.getByRole("button", { name: "Pause", exact: true }).waitFor()
		await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((button) => button.textContent === "Pause")?.disabled)
		await page.getByRole("button", { name: "Pause", exact: true }).click()
		await page.getByRole("button", { name: "Resume", exact: true }).waitFor()
		const startsBefore = await page.evaluate(() => window.continuationStarts.length)
		await page.getByRole("button", { name: "Resume", exact: true }).click()
		await page.getByRole("button", { name: "Pause", exact: true }).click()
		assert.equal(await page.evaluate(() => window.continuationStarts.length), startsBefore)
		for (const label of ["Rotation period", "Year length", "Planet radius", "Surface gravity", "Initial growth"]) assert(await sidebar.getByRole("slider", { name: label, exact: true }).isDisabled(), label)
		assert(await sidebar.getByRole("button", { name: "5 layers", exact: true }).isDisabled())
		assert(await sidebar.getByRole("slider", { name: "Stellar flux", exact: true }).isEnabled())
		await sidebar.getByRole("button", { name: "Edit Stellar flux", exact: true }).click()
		await sidebar.getByRole("spinbutton", { name: "Stellar flux", exact: true }).fill("1500")
		await sidebar.getByRole("spinbutton", { name: "Stellar flux", exact: true }).press("Enter")
		const target = sidebar.getByRole("spinbutton", { name: "Desired temperature", exact: true })
		if (!(await target.isVisible())) await sidebar.getByRole("button", { name: /^Atmosphere/ }).click()
		await sidebar.getByRole("button", { name: "Edit Model CO₂", exact: true }).click()
		await sidebar.getByRole("spinbutton", { name: "Model CO₂", exact: true }).fill("600")
		await sidebar.getByRole("spinbutton", { name: "Model CO₂", exact: true }).press("Enter")
		await target.fill("20")
		await page.getByRole("button", { name: "Resume", exact: true }).click()
		await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((button) => button.textContent === "Pause")?.disabled && [...document.querySelectorAll("button")].some((button) => button.textContent === "Pause"))
		await page.getByRole("button", { name: "Pause", exact: true }).click()
		assert.equal(await sidebar.getByRole("slider", { name: "Stellar flux", exact: true }).inputValue(), "1500")
		const applied = await page.evaluate(() => window.continuationStarts.findLast((start) => start.previousConfig && start.restart))
		assert.equal(applied.config.fluxWm2, 1500)
		assert.equal(applied.config.targetTemperatureK, 293.15)
		assert.equal(applied.months, 0)
		assert.equal(applied.years, 0)
		assert.equal(applied.config.layers, applied.previousConfig.layers)
		assert.equal(applied.config.timestepMinutes, applied.previousConfig.timestepMinutes)
		assert.equal(A.resolve(applied.config.atmosphere).values.co2Ppm, 600)
		assert.equal(A.resolve(applied.config.atmosphere).values.pressureBar, A.resolve(applied.previousConfig.atmosphere).values.pressureBar)
		assert.equal(A.resolve(applied.config.atmosphere).values.gasConstant, A.resolve(applied.previousConfig.atmosphere).values.gasConstant)
		await target.fill("")
		await page.getByRole("button", { name: "Resume", exact: true }).click()
		await page.waitForFunction(() => window.continuationStarts.at(-1)?.previousConfig && window.continuationStarts.at(-1).config.targetTemperatureK === null)
		await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Pause" && !button.disabled))
		await page.getByRole("button", { name: "Pause", exact: true }).click()
		await page.screenshot({ path: path.join(output, `paused-${engine.toLowerCase()}.png`), fullPage: true })
		await page.getByRole("button", { name: "Clear", exact: true }).click()
		console.log(JSON.stringify({ uiEngine: engine, passed: true }))
		report.ui.push({ engine, pausedEditing: true, modelLocked: true, resumedSettingsRetained: true, co2PreservesAtmosphere: true, targetingEnabledAndDisabled: true, averagesReset: true, unchangedResumeRetainsSession: true })
	}
	await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
} finally {
	await browser?.close()
	await server.close()
}

