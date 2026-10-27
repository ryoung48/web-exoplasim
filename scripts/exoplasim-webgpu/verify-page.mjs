import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer, preview } from "vite"

// V6 in the page: /gcm at T21 with Earth defaults. Records every snapshot
// the worker posts (by wrapping Worker), then checks the step sequence,
// Pause latency, Save → Load continuing identically to an unsaved run, and
// that a format-2 (Wasm) checkpoint is rejected.
const output = path.resolve(process.env.PREVIEW ? "stats/exoplasim-webgpu/page-build" : "stats/exoplasim-webgpu/page")
await fs.mkdir(output, { recursive: true })
const PUBLISH_EVERY = 4
const PAUSES = Number(process.env.PAUSES ?? 10)
const CONTINUE_STEPS = 48

// PREVIEW=1 serves `pnpm build`'s dist instead of the dev server, without
// React's development profiling.
const server = process.env.PREVIEW
	? await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" })
	: await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" })
if (!process.env.PREVIEW) await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
const report = { checks: {} }
const errors = []
try {
	const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } })
	const page = await context.newPage()
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await page.addInitScript(() => {
		window.__snapshots = []
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
				this.addEventListener("message", (event) => {
					if (event.data?.type !== "snapshots") return
					for (const { step, date, values } of event.data.snapshots)
						window.__snapshots.push({ step, date, time: performance.now(), sum: values.reduce((a, b) => a + b, 0), first: Array.from(values.subarray(0, 8)) })
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
	await button("Start").click()
	await waitFor({ test: async () => (await snapshots()).length >= 200, label: "200 snapshots" })
	const first = await snapshots()
	const gaps = first.slice(1).map((s, i) => s.step - first[i].step)
	report.checks.sequence = { snapshots: first.length, firstStep: first[0].step, firstDate: first[0].date, strictlyByPublishEvery: gaps.every((gap) => gap === PUBLISH_EVERY) }
	report.device = await row("GPU")
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

	// Save while paused, then the unsaved continuation.
	await button("Pause").click()
	await page.waitForTimeout(500)
	const saved = (await snapshots()).at(-1).step
	const downloading = page.waitForEvent("download")
	await button("Save").click()
	const download = await downloading
	const file = path.join(output, download.suggestedFilename())
	await download.saveAs(file)
	const target = saved + CONTINUE_STEPS
	await button("Resume").click()
	await waitFor({ test: async () => (await snapshots()).some((s) => s.step === target), label: `step ${target}` })
	const unsaved = (await snapshots()).find((s) => s.step === target)

	// Clear, Load and the same continuation.
	await button("Clear").click()
	await page.evaluate(() => {
		window.__snapshots = []
	})
	await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(file)
	await waitFor({ test: async () => (await page.getByRole("button", { name: "Resume", exact: true }).count()) > 0, label: "paused after Load" })
	await page.waitForTimeout(500)
	await button("Resume").click()
	await waitFor({ test: async () => (await snapshots()).some((s) => s.step === target), label: `reloaded step ${target}` })
	const reloaded = (await snapshots()).find((s) => s.step === target)
	report.checks.checkpoint = { file: path.basename(file), bytes: (await fs.stat(file)).size, savedAfterStep: saved, comparedStep: target, firstStepAfterLoad: (await snapshots())[0].step, identical: unsaved.sum === reloaded.sum && unsaved.first.every((v, i) => v === reloaded.first[i]), unsavedSum: unsaved.sum, reloadedSum: reloaded.sum }

	// A Wasm-era checkpoint is rejected.
	await button("Clear").click()
	const magic = "EXOPLASIM-CHECKPOINT\n"
	const header = JSON.stringify({ meta: { format: 2 } })
	const old = Buffer.alloc(magic.length + 4 + header.length + 8)
	old.write(magic, 0)
	old.writeUInt32LE(header.length, magic.length)
	old.write(header, magic.length + 4)
	const oldFile = path.join(output, "format2.ckpt")
	await fs.writeFile(oldFile, old)
	await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(oldFile)
	await page.waitForTimeout(1000)
	const status = await row("Status")
	report.checks.oldFormat = { status, rejected: /format/i.test(status ?? "") }
	await page.screenshot({ path: path.join(output, "gcm.png") })
	report.errors = errors
	report.chrome = browser.version()
} finally {
	await fs.writeFile(path.join(output, "page.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
	await browser.close()
	await (process.env.PREVIEW ? server.httpServer.close() : server.close())
}
