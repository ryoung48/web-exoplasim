import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const output = path.resolve("stats/exoplasim-targeting")
await fs.mkdir(output, { recursive: true })
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
const uiOnly = process.argv.includes("--ui-only")
const report = { unitChecks: [], runs: uiOnly ? JSON.parse(await fs.readFile(path.join(output, "verification.json"), "utf8")).runs : [] }
let browser
try {
	const load = (file) => server.ssrLoadModule(path.resolve(file))
	const { GCM } = await load("src/model/climate/gcm/index.ts")
	const { GCM_TARGETING: T } = await load("src/model/climate/gcm/targeting/index.ts")
	const { GCM_ATMOSPHERE: A } = await load("src/model/climate/gcm/atmosphere/index.ts")
	const { TEMPERATURE } = await load("src/model/shared/units/temperature/index.ts")
	const config = { ...GCM.DEFAULT_CONFIG, targetTemperatureK: 300 }
	const start = { ...T.create(config), trialStartYear: 0 }
	const years = (temperature, count = 20, energy = 0) => Array.from({ length: count }, (value, index) => ({ year: index + 1, surfaceTemperature: temperature, toaNetRadiation: energy, surfaceNetHeat: energy }))
	const assess = (options) => T.assess({ state: start, targetK: 300, years: years(288), ...options })
	const check = (name, callback) => { callback(); report.unitChecks.push(name) }
	check("blank target disabled by default", () => assert.equal(GCM.DEFAULT_CONFIG.targetTemperatureK, null))
	check("settled cold climate doubles CO2", () => assert.equal(assess().history[0].toCo2Ppm, 600))
	check("settled warm climate halves CO2", () => assert.equal(assess({ years: years(310) }).history[0].toCo2Ppm, 150))
	check("convergence requires settled multiyear mean", () => assert.equal(assess({ years: years(300.4) }).status, "converged"))
	check("transient target crossing does not converge", () => assert.equal(assess({ years: years(300, 19) }).status, "settling"))
	check("constant residual energy imbalance prevents convergence", () => assert.equal(assess({ years: years(300, 20, 3) }).status, "settling"))
	check("temperature drift prevents convergence", () => assert.equal(assess({ years: years(299).map((year, index) => ({ ...year, surfaceTemperature: 299 + index / 10 })) }).status, "settling"))
	check("previous forcing years are excluded", () => assert.equal(assess({ state: { ...start, trialStartYear: 20 } }).yearsAtForcing, 0))
	check("partial transition year is excluded", () => assert.equal(assess({ state: { ...start, trialStartYear: 1 } }).status, "settling"))
	check("logarithmic bracket narrows", () => {
		const state = { ...start, co2Ppm: 600, history: assess().history }
		assert(Math.abs(assess({ state, years: years(310) }).history[1].toCo2Ppm - Math.sqrt(300 * 600)) < 1e-9)
	})
	check("nonmonotonic climate response stops search", () => assert.equal(assess({ state: { ...start, history: [{ year: 0, temperatureK: 310, fromCo2Ppm: 150, toCo2Ppm: 300 }] } }).status, "limited"))
	check("unsettled trial times out", () => assert.equal(assess({ years: years(288, 200, 3) }).status, "limited"))
	check("upper CO2 bound stops search", () => assert.equal(assess({ state: { ...start, co2Ppm: 100000 } }).status, "limited"))
	check("lower CO2 bound stops search", () => assert.equal(assess({ state: { ...start, co2Ppm: 0.001 }, years: years(310) }).status, "limited"))
	check("zero CO2 can warm", () => assert.equal(assess({ state: { ...start, co2Ppm: 0 } }).history[0].toCo2Ppm, 0.001))
	check("zero CO2 cannot cool further", () => assert.equal(assess({ state: { ...start, co2Ppm: 0 }, years: years(310) }).status, "limited"))
	check("adjustment count is bounded", () => assert.equal(assess({ state: { ...start, history: Array(24).fill(assess().history[0]) } }).status, "limited"))
	check("missing annual history stops search", () => assert.equal(assess({ years: years(288, 21).filter((year) => year.year !== 5) }).status, "limited"))
	check("pressure and gas constant stay fixed for mixed atmospheres", () => {
		const mixture = { ...config, atmosphere: { ...config.atmosphere, partialPressures: { ...config.atmosphere.partialPressures, N2: 0.8, O2: 0.2, CO2: 0.001 } } }
		const before = A.resolve(mixture.atmosphere).values
		const after = A.resolve(T.forcing({ config: mixture, co2Ppm: 10000 }).atmosphere).values
		assert.equal(after.pressureBar, before.pressureBar)
		assert.equal(after.gasConstant, before.gasConstant)
		assert(Math.abs(after.co2Ppm - 10000) < 1e-8)
	})
	check("invalid temperature rejected", () => assert.throws(() => T.create({ ...config, targetTemperatureK: NaN })))
	check("invalid saved targeting rejected", () => assert.throws(() => T.validate({ config, state: { ...start, co2Ppm: 500 } })))
	check("temperature units round trip", () => assert.equal(TEMPERATURE.toCelsius({ value: TEMPERATURE.toDisplay({ value: 20, system: "imperial" }), system: "imperial" }), 20))
	await server.listen()
	browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })
	await page.addInitScript(() => {
		window.restartMessages = []
		window.workerLoads = []
		const Original = window.Worker
		window.Worker = class extends Original {
			constructor(...args) {
				super(...args)
				this.addEventListener("message", ({ data }) => {
					if ((data.type === "exit" || data.type === "checkpoint") && data.restart) window.restartMessages.push(data.restart.slice(0))
				})
			}
			postMessage(data, options) {
				if (data.type === "start" && window.seedTargeting) {
					window.seedTargeting = false
					data.averager = { current: null, months: [], years: Array.from({ length: 20 }, (value, index) => ({ year: index + 2, surfaceTemperature: 288, toaNetRadiation: 0, surfaceNetHeat: 0 })) }
				}
				if (data.type === "load") window.workerLoads.push({ rank: data.rank, co2: data.namelistEdits.radmod_namelist.CO2 })
				super.postMessage(data, options)
			}
		}
	})
	await page.goto(server.resolvedUrls.local[0])
	for (const [engine, layers, ranks] of uiOnly ? [] : [["gpu", 5, null], ["gpu", 10, null], ["cpu", 10, 2], ["cpu", 5, 4]]) {
		const result = await page.evaluate(async ({ engine, layers, ranks }) => {
			const { GCM } = await import("/src/model/climate/gcm/index.ts")
			const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
			const { GCM_TARGETING } = await import("/src/model/climate/gcm/targeting/index.ts")
			const { GCM_ATMOSPHERE } = await import("/src/model/climate/gcm/atmosphere/index.ts")
			const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
			const { GCM_CHECKPOINT } = await import("/src/model/climate/gcm/checkpoint/index.ts")
			const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
			const terrain = { name: "Targeting ocean", width: 4, height: 2, elevationM: new Float32Array(8), land: new Float32Array(8) }
			const config = { ...GCM.DEFAULT_CONFIG, targetTemperatureK: 300, layers, vegetation: 0 }
			const resolution = (await GCM_RUNNER.resolutions()).find((entry) => entry.truncation === 21 && entry.layers === layers)
			const averager = GCM_AVERAGES.create()
			averager.years = Array.from({ length: 20 }, (value, index) => ({ year: index + 1, surfaceTemperature: 288, toaNetRadiation: 0, surfaceNetHeat: 0 }))
			const state = { ...GCM_TARGETING.create(config), trialStartYear: 0 }
			let run, failure, latest, saved, activeConfig, targeting, status
			let awaitingSave = false
			let changed = false
			const snapshots = []
			window.restartMessages = []
			window.workerLoads = []
			const wait = async (predicate) => {
				const deadline = performance.now() + 180000
				while (!predicate()) {
					if (failure) throw new Error(failure)
					if (performance.now() > deadline) throw new Error(`Timed out: ${engine} ${status}`)
					await new Promise((resolve) => setTimeout(resolve, 25))
				}
			}
			const base = { engine, ranks, config, terrain, resolution, publishEvery: 4, onAverages() {}, onDevice() {}, onStatus(update) { status = update.status; if (status === "failed") failure = update.message }, onSnapshot(snapshot) { latest = snapshot; if (changed) snapshots.push(snapshot) }, onTargeting(update) {
				activeConfig = update.config
				targeting = update.state
				if (targeting.status === "adjusting") { awaitingSave = true; run.checkpoint() }
				if (!changed && targeting.co2Ppm === 600) { changed = true; run.pause() }
			}, onCheckpoint(checkpoint) { if (awaitingSave) saved = checkpoint } }
			try {
				run = GCM_RUNNER.start({ ...base, restart: null, averager, targeting: state, startPaused: false })
				await wait(() => changed && status === "paused")
				const originalRestart = window.restartMessages[0].slice(0)
				const co2 = GCM_ATMOSPHERE.resolve(activeConfig.atmosphere).values.co2Ppm
				if (Math.abs(co2 - 600) > 1e-6 || targeting.history.length !== 1) throw new Error("Automatic adjustment was not applied")
				await wait(() => saved)
				if (saved.targeting.status !== "settling" || saved.targeting.co2Ppm !== 600) throw new Error("Save during adjustment lost the pending change")
				saved = null
				awaitingSave = true
				run.checkpoint()
				await wait(() => saved)
				const meta = { format: GCM_CHECKPOINT.FORMATS[engine], config: activeConfig, precisionBytes: engine === "gpu" ? 4 : resolution.cpu.precisionBytes, date: latest.date, step: latest.step }
				const decoded = GCM_CHECKPOINT.decode(GCM_CHECKPOINT.encode({ meta, terrain, restart: saved.restart, diagnostics: { snapshot: latest, averager: saved.averager, targeting: saved.targeting } }))
				if (decoded.diagnostics.targeting.co2Ppm !== 600) throw new Error("Targeting checkpoint lost CO2")
				run.stop()
				const reload = decoded.diagnostics.targeting
				let resumed = false
				run = GCM_RUNNER.start({ ...base, config: decoded.meta.config, restart: decoded.restart, averager: decoded.diagnostics.averager, targeting: reload, startPaused: true, onStatus(update) { base.onStatus(update); if (update.status === "paused") resumed = true } })
				await wait(() => resumed)
				if (targeting.history.length !== 1 || targeting.initialCo2Ppm !== 300) throw new Error("Reload lost search history")
				run.resume()
				await wait(() => snapshots.length >= 8)
				run.stop()
				const changedSnapshots = snapshots.slice()
				let fixedRun
				const fixed = []
				try {
					fixedRun = GCM_RUNNER.start({ ...base, config: { ...GCM_TARGETING.forcing({ config, co2Ppm: 300 }), targetTemperatureK: null }, restart: originalRestart, averager: null, targeting: null, startPaused: false, onSnapshot(snapshot) { fixed.push(snapshot) }, onCheckpoint() {} })
					await wait(() => fixed.length >= 12)
				} finally { fixedRun?.stop() }
				const shared = changedSnapshots.map((snapshot) => [snapshot, fixed.find((other) => other.step === snapshot.step)]).filter((pair) => pair[1])
				if (!shared.length) throw new Error("No common steps after continuation")
				const [warm, control] = shared[0]
				const changedIr = GCM_FIELDS.field({ snapshot: warm, field: "toaLongwave" })
				const fixedIr = GCM_FIELDS.field({ snapshot: control, field: "toaLongwave" })
				const radiationDifference = changedIr.reduce((sum, value, index) => sum + Math.abs(value - fixedIr[index]), 0) / changedIr.length
				if (!(radiationDifference > 1e-5)) throw new Error("Changed CO2 had no radiative effect")
				if (!warm.values.every(Number.isFinite)) throw new Error("Nonfinite continuation")
				if (engine === "cpu" && !window.workerLoads.some((load) => Number(load.co2) === 600)) throw new Error("CPU workers did not receive new CO2")
				return { engine, layers, ranks, co2, saveDuringAdjustment: true, historySaved: true, pausedReload: true, comparedStep: warm.step, meanAbsoluteRadiationDifferenceWm2: radiationDifference }
			} finally { run?.stop() }
		}, { engine, layers, ranks })
		report.runs.push(result)
		console.log(JSON.stringify(result))
	}
	report.terminalStates = await page.evaluate(async () => {
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
		const { GCM_TARGETING } = await import("/src/model/climate/gcm/targeting/index.ts")
		const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
		const terrain = { name: "Terminal state ocean", width: 4, height: 2, elevationM: new Float32Array(8), land: new Float32Array(8) }
		const config = { ...GCM.DEFAULT_CONFIG, targetTemperatureK: 300, layers: 5, vegetation: 0 }
		const resolution = (await GCM_RUNNER.resolutions()).find((entry) => entry.truncation === 21 && entry.layers === 5)
		const results = []
		for (const terminal of ["converged", "limited"]) {
			const averager = GCM_AVERAGES.create()
			averager.years = Array.from({ length: terminal === "converged" ? 20 : 200 }, (value, index) => ({ year: index + 1, surfaceTemperature: 300, toaNetRadiation: terminal === "converged" ? 0 : 5, surfaceNetHeat: 0 }))
			let run, target, status, failure
			try {
				run = GCM_RUNNER.start({ engine: "gpu", ranks: null, config, terrain, resolution, publishEvery: 4, restart: null, averager, targeting: { ...GCM_TARGETING.create(config), trialStartYear: 0 }, startPaused: false,
					onSnapshot() {}, onAverages() {}, onDevice() {}, onCheckpoint() {}, onTargeting(update) { target = update.state }, onStatus(update) { status = update.status; if (status === "failed") failure = update.message } })
				const deadline = performance.now() + 60000
				while (target?.status !== terminal || status !== "paused") {
					if (failure || performance.now() > deadline) throw new Error(failure ?? `Did not pause on ${terminal}`)
					await new Promise((resolve) => setTimeout(resolve, 25))
				}
				if (target.history.length !== 0) throw new Error("Terminal state changed CO2")
				results.push({ status: terminal, paused: true, co2Unchanged: true })
			} finally { run?.stop() }
		}
		return results
	})
	await page.goto(new URL("gcm", server.resolvedUrls.local[0]).href)
	const input = page.getByRole("spinbutton", { name: "Desired temperature", exact: true })
	if (!(await input.isVisible())) await page.locator("#gcm-sidebar").getByRole("button", { name: "Atmosphere", exact: true }).click()
	assert.equal(await input.inputValue(), "")
	await input.fill("20")
	await page.getByRole("button", { name: "Imperial", exact: true }).click()
	assert.equal(Number(await input.inputValue()), 68)
	await input.fill("")
	await page.getByRole("button", { name: "Metric", exact: true }).click()
	assert.equal(await input.inputValue(), "")
	await input.fill("20")
	await page.evaluate(() => { window.seedTargeting = true })
	await page.getByRole("button", { name: "Start", exact: true }).click()
	const progress = page.getByLabel("Temperature targeting progress", { exact: true })
	await progress.waitFor()
	await progress.getByText("600.000 ppm", { exact: true }).waitFor()
	assert(await progress.getByText("+300.000 ppm", { exact: true }).isVisible())
	assert(await progress.getByText("300.000 ppm → 600.000 ppm (+300.000 ppm)", { exact: true }).isVisible())
	await page.getByRole("button", { name: "Pause", exact: true }).click()
	await page.screenshot({ path: path.join(output, "targeting-panel.png"), fullPage: true })
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	report.ui = { blankDisables: true, imperialConversion: true, inputEnables: true, progressVisible: true, signedAdjustmentVisible: true }
	await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
} finally {
	await browser?.close()
	await server.close()
}
