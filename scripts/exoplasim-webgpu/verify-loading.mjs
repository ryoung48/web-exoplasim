import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer, preview } from "vite"

const output = path.resolve(`stats/exoplasim-webgpu/${process.env.PREVIEW ? "loading-build" : "loading"}`)
await fs.mkdir(output, { recursive: true })
const server = process.env.PREVIEW
	? await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" })
	: await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
if (!process.env.PREVIEW) await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
try {
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
	const errors = []
	page.on("pageerror", error => errors.push(error.message))
	await page.addInitScript(() => {
		window.latestSnapshot = null
		window.startupLongTasks = []
		window.startupStart = Infinity
		new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.startTime >= window.startupStart) window.startupLongTasks.push({ start: entry.startTime, duration: entry.duration }) }).observe({ type: "longtask", buffered: true })
		const Original = window.Worker
		// Observe real model output without replacing the worker.
		window.Worker = class extends Original {
			constructor(...args) { super(...args); this.addEventListener("message", ({ data }) => { if (data.type === "progress") window.latestSnapshot = data.latest }) }
		}
	})
	await page.goto(server.resolvedUrls.local[0])
	const preparation = process.env.PREVIEW ? null : await page.evaluate(async () => {
		const { GCM_PREPARATION } = await import("/src/model/climate/gcm/preparation/index.ts")
		const { GCM_BOUNDARY } = await import("/src/model/climate/gcm/boundary/index.ts")
		const { GCM_DOWNSCALE } = await import("/src/model/climate/gcm/downscale/index.ts")
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const terrain = { name: "Preparation check", width: 4, height: 2, elevationM: new Float32Array([1000,1000,0,0,1000,1000,0,0]), land: new Float32Array([1,1,0,0,1,1,0,0]) }
		const grid = GCM_GRID.forTruncation(21)
		const controller = new AbortController()
		const input = { terrain, grid, gravityMs2: 12 }
		const boundary = await GCM_PREPARATION.run({ kind: "boundary", input, signal: controller.signal })
		if (JSON.stringify(boundary) !== JSON.stringify(GCM_BOUNDARY.files(GCM_BOUNDARY.fromTerrain(input)))) throw new Error("Worker boundary differs")
		const downscaleInput = { terrain, grid, factor: 1 }
		const downscale = await GCM_PREPARATION.run({ kind: "downscale", input: downscaleInput, signal: controller.signal })
		const expected = GCM_DOWNSCALE.create(downscaleInput)
		for (const name of ["elevationM", "land", "modelElevationM", "cellElevationM", "corners", "weights"]) if (!downscale[name].every((value, index) => value === expected[name][index])) throw new Error(`Worker downscale differs: ${name}`)
		const cancel = new AbortController()
		const pending = GCM_PREPARATION.run({ kind: "downscale", input: downscaleInput, signal: cancel.signal })
		cancel.abort()
		const cancelled = await pending.then(() => false, error => error.name === "AbortError")
		const failed = await GCM_PREPARATION.run({ kind: "downscale", input: { ...downscaleInput, factor: 0 }, signal: controller.signal }).then(() => false, () => true)
		if (!cancelled || !failed || terrain.land.byteLength === 0) throw new Error("Preparation cancellation, error or input ownership failed")
		return { boundaryIdentical: true, downscaleIdentical: true, cancelled, failed, inputRetained: true }
	})
	await page.goto(new URL("gcm", server.resolvedUrls.local[0]).href)
	await page.getByRole("button", { name: /^T63 / }).click()
	await page.waitForLoadState("networkidle")
	await page.getByRole("button", { name: "Start", exact: true }).click()
	const skeleton = page.getByRole("status", { name: "Loading climate map", exact: true })
	await skeleton.waitFor({ state: "visible" })
	await page.screenshot({ path: path.join(output, "loading.png") })
	const animation = await skeleton.locator(".animate-pulse, .motion-safe\\:animate-pulse").evaluate(element => getComputedStyle(element).animationName)
	assert.equal(animation, "pulse")
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	await skeleton.waitFor({ state: "hidden" })
	await page.waitForTimeout(300)
	assert.equal(await page.getByRole("button", { name: "Start", exact: true }).isVisible(), true)
	await page.evaluate(() => { window.startupStart = performance.now(); window.startupLongTasks = []; window.latestSnapshot = null })
	await page.getByRole("button", { name: "Start", exact: true }).click()
	await skeleton.waitFor({ state: "visible" })
	const clicked = Date.now()
	await page.getByRole("button", { name: "Hide settings panel", exact: true }).click()
	await page.locator("#gcm-sidebar").waitFor({ state: "hidden" })
	const interactionMs = Date.now() - clicked
	assert(interactionMs < 500, `Loading blocked the controls for ${interactionMs} ms`)
	await page.waitForFunction(() => window.latestSnapshot !== null, {}, { timeout: 90000 })
	await skeleton.waitFor({ state: "hidden" })
	const startup = await page.evaluate(() => ({ finite: window.latestSnapshot.values.every(Number.isFinite), longTasks: window.startupLongTasks, points: window.latestSnapshot.values.length / (42 + 5 * window.latestSnapshot.layers) }))
	assert(startup.finite && startup.points === 18432)
	assert(startup.longTasks.every(task => task.duration < 500), "A startup task blocked the page for 500 ms")
	await page.getByRole("button", { name: "Show settings panel", exact: true }).click()
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	await page.route("**/gcm/t63/namelists.json", route => route.fulfill({ status: 404, body: "Missing" }))
	await page.getByRole("button", { name: "Start", exact: true }).click()
	await page.getByText("Missing t63/namelists.json in public/gcm", { exact: true }).first().waitFor()
	await skeleton.waitFor({ state: "hidden" })
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	await page.unroute("**/gcm/t63/namelists.json")
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.getByRole("button", { name: "Start", exact: true }).click()
	await skeleton.waitFor({ state: "visible" })
	const reducedAnimation = await skeleton.locator(".motion-safe\\:animate-pulse").evaluate(element => getComputedStyle(element).animationName)
	assert.equal(reducedAnimation, "none")
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	const report = { preparation, startup, interactionMs, animation, reducedAnimation, cancelAndRetry: true, failureClearsLoader: true, errors }
	await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
	assert.equal(errors.length, 0)
} finally {
	await browser.close()
	await server.close()
}
