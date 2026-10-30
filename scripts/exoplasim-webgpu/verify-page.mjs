import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer, preview } from "vite"

// V6 in the page: /gcm at T21 with Earth defaults. Records every snapshot
// the worker posts (by wrapping Worker), then checks the step sequence,
// Pause latency, Save → Load continuing identically to an unsaved run, and
// that an unsupported checkpoint format is rejected. ENGINE picks gpu (the
// default) or cpu.
const LAYERS = Number(process.env.LAYERS ?? 10)
const TRUNCATION = Number(process.env.TRUNCATION ?? 21)
const output = path.resolve(`stats/exoplasim-webgpu/${process.env.PREVIEW ? "page-build" : "page"}-${process.env.ENGINE ?? "gpu"}-t${TRUNCATION}-l${LAYERS}`)
await fs.mkdir(output, { recursive: true })
const PUBLISH_EVERY = 4
// ENGINE=cpu runs the Wasm model instead of the default GPU engine.
const ENGINE = process.env.ENGINE ?? "gpu"
const STORMCLIM = process.env.STORMCLIM === "1"
const PAUSES = Number(process.env.PAUSES ?? 10)
const CONTINUE_STEPS = 48
// How far both continuations run, so they share some posted steps.
const HORIZON_STEPS = 1200

// PREVIEW=1 serves `pnpm build`'s dist instead of the dev server, without
// React's development profiling.
const server = process.env.PREVIEW
	? await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" })
	: await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null }, logLevel: "error" })
if (!process.env.PREVIEW) await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
const snapshotRecord = (snapshot) => {
 const { step, date, values, layers } = snapshot
 const points = values.length / (51 + 5 * layers)
 return { step, date, layers, fields: 51 + 5 * layers, diagnostic: [35, 36, 37, 38, 39, 51 + 5 * (layers - 1) + 3].map((field) => values[field * points]), finite: values.every(Number.isFinite), sum: values.reduce((a, b) => a + b, 0), first: Array.from(values.subarray(0, 8)) }
}
const report = { checks: {} }
const errors = []
try {
	const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } })
	const page = await context.newPage()
	await page.route("**/assets/gcm.worker-*.js", async (route) => {
		const response = await route.fetch()
		const body = await response.text()
		const expression = /latest:([A-Za-z_$][\w$]*)\[\1\.length-1\]/
		if (!expression.test(body)) return route.fulfill({ response })
		const prefix = `self.testFingerprint = ${snapshotRecord.toString()}; self.addEventListener("message", event => { if (event.data?.type === "test-trace") { self.testTrace = true; event.stopImmediatePropagation(); } });\n`
		await route.fulfill({ response, body: prefix + body.replace(expression, (match, variable) => `${match},testSnapshots:self.testTrace?${variable}.map(self.testFingerprint):undefined`) })
	})
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await page.addInitScript({ content: `window.__snapshotRecord = ${snapshotRecord.toString()}` })
	await page.addInitScript(() => {
		window.__snapshots = []
		window.__workers = []
		window.__trace = false
		window.__clicks = []
		window.__longTasks = []
		document.addEventListener("click", () => window.__clicks.push(performance.now()), true)
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration })
		}).observe({ type: "longtask", buffered: true })
		const Original = window.Worker
		window.Worker = class extends Original {
			constructor(...args) {
				super(...args)
				const traceable = String(args[0]).includes("/gcm.worker-")
				if (traceable) window.__workers.push(this)
				if (window.__trace && traceable) this.postMessage({ type: "test-trace" })
				this.addEventListener("message", (event) => {
					// The GPU worker posts each batch's latest snapshot; the Wasm
					// workers post every snapshot.
					const snapshot = event.data?.type === "progress" ? event.data.latest : event.data?.type === "snapshot" ? event.data.snapshot : null
					if (!snapshot) return
					const records = event.data.testSnapshots ?? [window.__snapshotRecord(snapshot)]
					for (const record of records) window.__snapshots.push({ ...record, time: performance.now() })
				})
			}
		}
	})
	await page.goto(new URL("gcm", server.resolvedUrls.local[0]).href)
	const button = (name) => page.getByRole("button", { name, exact: true })
	const snapshots = () => page.evaluate(() => window.__snapshots)
	const waitFor = async ({ test, label, seconds = 120 }) => {
		const until = Date.now() + seconds * 1000
		while (Date.now() < until) {
			if (await test()) return
			await page.waitForTimeout(100)
		}
		throw new Error(`Timed out waiting for ${label}`)
	}
	const row = (label) => page.locator(`text=${label}`).first().locator("xpath=following-sibling::*[1]").textContent()

	// Start and the step sequence.
	await button(ENGINE.toUpperCase()).click()
	await button(`${LAYERS} layers`).click()
	await page.getByRole("button", { name: new RegExp(`^T${TRUNCATION} `) }).click()
	if (STORMCLIM) {
		assert.equal(await button("Storms").count(), 0)
		await page.getByRole("checkbox", { name: "Storm climatology", exact: true }).check()
		assert.equal(await button("Storms").isEnabled(), true)
	}
	await button("Start").click()
	await waitFor({ test: async () => (await snapshots()).length >= 100, label: "100 batches" })
	const first = await snapshots()
	const gaps = first.slice(1).map((s, i) => s.step - first[i].step)
	// The page receives each batch's latest snapshot: steps rise, each a
	// published (multiple of publishEvery) step.
	report.checks.sequence = { messages: first.length, firstStep: first[0].step, firstDate: first[0].date, increasingPublishedSteps: gaps.every((gap) => gap > 0) && first.every((s) => s.step % PUBLISH_EVERY === 0) }
	report.checks.diagnostics = { layers: first[0].layers, fields: first[0].fields, finite: first.every((s) => s.finite), validExtrema: first.every((s) => s.diagnostic[0] <= s.diagnostic[1]), completedDayRange: first.some((s) => s.diagnostic[2] > 0), humidity: first.at(-1).diagnostic[5] }
	report.device = await row(ENGINE === "gpu" ? "GPU" : "Workers")
	// Steady-state speed: steps advanced over 10 s, at 45-minute steps.
	const before = (await snapshots()).at(-1)
	await page.waitForTimeout(10000)
	const after = (await snapshots()).at(-1)
	report.speed = `${(((after.step - before.step) * 45) / 1440 / ((after.time - before.time) / 1000)).toFixed(2)} model days/s`

	// Pause latency: click to the last snapshot that arrives after it.
	const latencies = []
	const inputDelays = []
	for (let i = 0; i < PAUSES; i++) {
		const clicked = await page.evaluate(() => performance.now())
		await button("Pause").click()
		await page.waitForTimeout(400)
		const handled = await page.evaluate(() => window.__clicks.at(-1))
		const after = (await snapshots()).filter((s) => s.time >= handled)
		inputDelays.push(handled - clicked)
		latencies.push(after.length ? after[after.length - 1].time - handled : 0)
		await button("Resume").click()
		await page.waitForTimeout(300)
	}
	const longTasks = await page.evaluate(() => window.__longTasks.map((task) => task.duration))
	report.mainThread = { longTasks: longTasks.length, medianMs: longTasks.sort((a, b) => a - b)[longTasks.length >> 1], maxMs: Math.max(...longTasks) }
	report.checks.pause = { inputDelaysMs: inputDelays.map((ms) => Math.round(ms)), latenciesMs: latencies.map((ms) => Math.round(ms)), maxMs: Math.round(Math.max(...latencies)), pass: Math.max(...latencies) <= 100 }

	// Extra snapshot tracing starts after timing, only in the test-served worker.
	if (ENGINE === "gpu" && process.env.PREVIEW) await page.evaluate(() => {
		window.__trace = true
		for (const worker of window.__workers) worker.postMessage({ type: "test-trace" })
	})
	// Save while paused, then the unsaved continuation.
	await button("Pause").click()
	await page.waitForTimeout(500)
	const saved = (await snapshots()).at(-1).step
	const downloading = page.waitForEvent("download")
	await button("Save").click()
	const download = await downloading
	const file = path.join(output, download.suggestedFilename())
	await download.saveAs(file)
	if (STORMCLIM) {
		const bytes = await fs.readFile(file)
		const start = Buffer.byteLength("EXOPLASIM-CHECKPOINT\n")
		const length = bytes.readUInt32LE(start)
		const header = JSON.parse(bytes.subarray(start + 4, start + 4 + length).toString("utf8"))
		assert.equal(header.meta.config.stormclim, true)
		await button("Storms").click()
		for (const label of ["CAPE", "LNB", "Intensity", "Entropy", "Vorticity", "Ventilation", "Reduced intensity", "Genesis", "Shear"]) await button(label).click()
		await button("Intensity").click()
		await page.screenshot({ path: path.join(output, "storm.png") })
		report.checks.storm = { toggle: true, savedConfig: true, maps: 9 }
	}
	// Batch sizes follow timing, so the two continuations post different
	// steps; they are compared at every step both posted, from saved + 48.
	const target = saved + CONTINUE_STEPS
	const horizon = saved + HORIZON_STEPS
	await button("Resume").click()
	await waitFor({ test: async () => (await snapshots()).some((s) => s.step >= horizon), label: `step ${horizon}` })
	await button("Pause").click()
	await page.waitForTimeout(300)
	const unsaved = new Map((await snapshots()).filter((s) => s.step >= target).map((s) => [s.step, s]))

	// Clear, Load and the same continuation.
	await button("Clear").click()
	await page.evaluate(() => {
		window.__snapshots = []
	})
	await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(file)
	await waitFor({ test: async () => (await page.getByRole("button", { name: "Resume", exact: true }).count()) > 0, label: "paused after Load" })
	await page.waitForTimeout(500)
	if (STORMCLIM) assert.equal(await page.getByRole("checkbox", { name: "Storm climatology", exact: true }).isChecked(), true)
	await button("Resume").click()
	await waitFor({ test: async () => (await snapshots()).some((s) => s.step >= horizon), label: `reloaded step ${horizon}` })
	const reloaded = (await snapshots()).filter((s) => unsaved.has(s.step))
	const same = (a, b) => a.sum === b.sum && a.first.every((v, i) => v === b.first[i])
	report.checks.checkpoint = { file: path.basename(file), bytes: (await fs.stat(file)).size, savedAfterStep: saved, firstStepAfterLoad: (await snapshots())[0].step, comparedSteps: reloaded.map((s) => s.step), identical: reloaded.length > 0 && reloaded.every((s) => same(s, unsaved.get(s.step))) }

	await button("Pause").click()
	await page.waitForTimeout(300)
	const climate = button("Climate")
	if (await climate.isEnabled()) {
		await climate.click()
		await button("Pasta").click()
		report.checks.pasta = { available: true }
	}
	await page.screenshot({ path: path.join(output, "pasta.png") })

	// A checkpoint in an unsupported format is rejected.
	await button("Clear").click()
	const magic = "EXOPLASIM-CHECKPOINT\n"
	const header = JSON.stringify({ meta: { format: 1 } })
	const old = Buffer.alloc(magic.length + 4 + header.length + 8)
	old.write(magic, 0)
	old.writeUInt32LE(header.length, magic.length)
	old.write(header, magic.length + 4)
	const oldFile = path.join(output, "format1.ckpt")
	await fs.writeFile(oldFile, old)
	await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(oldFile)
	await page.waitForTimeout(1000)
	const status = await row("Status")
	report.checks.oldFormat = { status, rejected: /format/i.test(status ?? "") }
	await page.screenshot({ path: path.join(output, "gcm.png") })
	report.errors = errors
	report.chrome = browser.version()
	assert(report.checks.sequence.increasingPublishedSteps)
	assert(report.checks.diagnostics.finite && report.checks.diagnostics.validExtrema && report.checks.diagnostics.completedDayRange)
	assert(report.checks.checkpoint.identical)
	assert(report.checks.oldFormat.rejected)
	assert.equal(errors.length, 0)
} finally {
	await fs.writeFile(path.join(output, "page.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, (key, value) => key === "comparedSteps" ? { count: value.length, first: value[0], last: value.at(-1) } : value, 2))
	await browser.close()
	await (process.env.PREVIEW ? server.httpServer.close() : server.close())
}
