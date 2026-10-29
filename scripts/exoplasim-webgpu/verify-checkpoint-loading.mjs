import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const filePath = process.argv[2]
if (!filePath) throw new Error("Pass the path to a current-format .ckpt file")
const bytes = await fs.readFile(filePath)
const output = path.resolve("stats/checkpoint-loading")
await fs.mkdir(output, { recursive: true })
const server = await createServer({
	server: { host: "127.0.0.1", port: 0, watch: null },
	logLevel: "error",
	plugins: [{
		name: "checkpoint-test-file",
		configureServer(server) {
			server.middlewares.use("/checkpoint-test.ckpt", (request, response) => {
				request.resume()
				response.setHeader("Content-Type", "application/octet-stream")
				response.end(bytes)
			})
		},
	}],
})
await server.listen()
const browser = await chromium.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--enable-unsafe-webgpu"],
})
try {
	const page = await browser.newPage()
	page.on("console", (message) => console.log(message.text()))
	page.on("pageerror", (error) => console.error(error.message))
	await page.route("**/checkpoint-test", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Checkpoint worker test</title>" }))
	await page.goto(new URL("checkpoint-test", server.resolvedUrls.local[0]).href)
	const report = await page.evaluate(async () => {
		const { GCM_PREPARATION } = await import("/src/model/climate/gcm/preparation/index.ts")
		const { GCM_CHECKPOINT } = await import("/src/model/climate/gcm/checkpoint/index.ts")
		const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
		const buffer = await (await fetch("/checkpoint-test.ckpt")).arrayBuffer()
		console.log("Checkpoint fixture read")
		const file = new File([buffer], "checkpoint.ckpt")
		const expected = GCM_CHECKPOINT.decode(buffer)
		const expectedAverages = GCM_AVERAGES.view({
			averager: expected.diagnostics.averager,
			config: expected.meta.config,
		})
		console.log("Synchronous reference prepared")
		const longTasks = []
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				if (entry.startTime >= start) longTasks.push(entry.duration)
		})
		observer.observe({ type: "longtask" })
		let ticks = 0
		const timer = setInterval(() => ticks++, 10)
		const start = performance.now()
		const actual = await GCM_PREPARATION.run({
			kind: "checkpoint", input: file, signal: new AbortController().signal,
		})
		const workerMs = performance.now() - start
		console.log("Worker result received")
		clearInterval(timer)
		observer.disconnect()
		const equal = ({ actual, expected }) => {
			if (ArrayBuffer.isView(expected)) {
				if (actual.constructor !== expected.constructor || actual.length !== expected.length ||
					!actual.every((value, index) => Object.is(value, expected[index])))
					throw new Error("Worker changed a diagnostic array")
			} else if (expected instanceof ArrayBuffer) {
				equal({ actual: new Uint8Array(actual), expected: new Uint8Array(expected) })
			} else if (expected && typeof expected === "object") {
				for (const key of Object.keys(expected)) equal({ actual: actual[key], expected: expected[key] })
			} else if (!Object.is(actual, expected)) throw new Error("Worker changed checkpoint data")
		}
		equal({ actual, expected: { checkpoint: expected, averages: expectedAverages } })
		const cancel = new AbortController()
		const pending = GCM_PREPARATION.run({ kind: "checkpoint", input: file, signal: cancel.signal })
		cancel.abort()
		const cancelled = await pending.then(() => false, (error) => error.name === "AbortError")
		const invalid = await GCM_PREPARATION.run({
			kind: "checkpoint", input: new File(["invalid"], "invalid.ckpt"), signal: new AbortController().signal,
		}).then(() => false, (error) => error.message.includes("Not an ExoPlaSim checkpoint"))
		return { bytes: file.size, workerMs, ticks, longTasks, identical: true, cancelled, invalid }
	})
	if (process.env.CHECKPOINT_UI === "1") {
		await page.goto(new URL("gcm", server.resolvedUrls.local[0]).href)
		await page.waitForLoadState("networkidle")
		await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(filePath)
		await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 60000 })
		await page.getByRole("button", { name: "Clear", exact: true }).click()
		await page.getByRole("button", { name: "Start", exact: true }).waitFor()
		report.uiPausedRestoreAndClear = true
	}
	await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
	assert.ok(report.identical && report.cancelled && report.invalid)
	assert.ok(report.ticks > 0, "UI event loop did not run during checkpoint loading")
} finally {
	await browser.close()
	await server.close()
}
