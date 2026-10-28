import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const label = process.argv[2] ?? "current"
const overlap = process.argv[3] === "overlap"
const output = path.resolve("stats/exoplasim-webgpu/load")
await fs.mkdir(output, { recursive: true })
const replace = ({ code, before, after }) => {
	assert(code.includes(before), `Missing instrumentation point: ${before}`)
	return code.replace(before, after)
}
const startupProbe = () => ({ name: "startup-measurement", enforce: "pre", transform(source, id) {
		if (!id.split("?")[0].replaceAll("\\", "/").endsWith("/runner/webgpu/gcm.worker.ts")) return
		if (overlap) {
			source = replace({ code: source, before: "\tconst [kernels, pack, startup] = await Promise.all([", after: "\tconst compilation = Promise.all([" })
			source = replace({ code: source, before: "\t\tcarbonStep = 0\n\t\t// master's start-up steps", after: "\t\tcarbonStep = 0\n\t}\n\tconst [kernels, pack, startup] = await compilation\n\tif (!request.restart) {\n\t\t// master's start-up steps" })
		}
		let code = replace({ code: source, before: "async function start(request: GcmWorkerStart) {", after: `async function start(request: GcmWorkerStart) {
		const startupProfile = { marks: [], pipelines: 0, started: performance.now() };
		const mark = (name) => startupProfile.marks.push({ name, ms: performance.now() - startupProfile.started });
		const requestDevice = GCM_DEVICE.request;
		GCM_DEVICE.request = async (request) => {
			const result = await requestDevice(request);
			mark("device");
			const createPipeline = result.device.createComputePipelineAsync.bind(result.device);
			result.device.createComputePipelineAsync = (descriptor) => { startupProfile.pipelines++; return createPipeline(descriptor); };
			return result;
		};` })
		code = replace({ code, before: "\tconst schedule = SETUP.schedule", after: '\tmark("initial-state");\n\tconst schedule = SETUP.schedule' })
		code = replace({ code, before: "\tconst latitudes = PUMAMOD.latitudes", after: '\tmark("schedule");\n\tconst latitudes = PUMAMOD.latitudes' })
		code = replace({ code, before: "\tconst write = (", after: '\tmark("tables-upload");\n\tconst write = (' })
		if (overlap) {
			code = replace({ code, before: "\tconst [kernels, pack, startup] = await compilation", after: '\tmark("state-upload");\n\tconst [kernels, pack, startup] = await compilation' })
			code = replace({ code, before: "\tif (!request.restart) {", after: '\tmark("main-pipelines");\n\tif (!request.restart) {' })
		} else code = replace({ code, before: "\tif (request.restart) {", after: '\tmark("main-pipelines");\n\tif (request.restart) {' })
		code = replace({ code, before: "\twriteBm1(schedule.main.bm1)", after: '\tmark("startup-phases");\n\twriteBm1(schedule.main.bm1)' })
		code = replace({ code, before: '\t\t\ttype: "loaded",', after: '\t\t\ttype: "loaded", probe: { ...startupProfile, totalMs: performance.now() - startupProfile.started },' })
		return code
	} })
const server = await createServer({
	server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error",
	plugins: [startupProbe()], worker: { plugins: () => [startupProbe()] },
})
await server.listen()
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
try {
	const page = await browser.newPage()
	await page.addInitScript(() => {
		window.startupProbes = []
		const Original = window.Worker
		window.Worker = class extends Original {
			constructor(...args) { super(...args); this.addEventListener("message", ({ data }) => { if (data.type === "loaded") window.startupProbes.push(data.probe) }) }
		}
	})
	await page.goto(server.resolvedUrls.local[0])
	const rows = await page.evaluate(async () => {
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
		const resolutions = await GCM_RUNNER.resolutions()
		const terrain = { name: "Startup test", width: 4, height: 2, elevationM: new Float32Array([1000, 1000, 0, 0, 1000, 1000, 0, 0]), land: new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]) }
		const result = []
		for (const truncation of [21, 63]) for (const earthSurfaceClimatology of [false, true]) {
			let run
			performance.clearResourceTimings()
			const started = performance.now()
			try {
				const snapshot = await new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error("Startup timed out")), 120000)
					run = GCM_RUNNER.start({ engine: "gpu", ranks: null, config: { ...GCM.DEFAULT_CONFIG, truncation, earthSurfaceClimatology, timestepMinutes: 20 }, terrain, resolution: resolutions.find(entry => entry.truncation === truncation && entry.layers === 10), publishEvery: 128, restart: null, averager: null, startPaused: false,
						onSnapshot(snapshot) { clearTimeout(timer); resolve(snapshot) }, onAverages() {}, onDevice() {}, onCheckpoint() {},
						onStatus({ status, message }) { if (status === "failed") { clearTimeout(timer); reject(new Error(message)) } },
					})
				})
				let hash = 2166136261
				for (const value of new Uint32Array(snapshot.values.buffer, snapshot.values.byteOffset, snapshot.values.length)) hash = Math.imul(hash ^ value, 16777619)
				const probe = window.startupProbes.at(-1)
				if (!probe) throw new Error("Startup instrumentation did not run")
				const inputs = performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname).filter(name => /\/gcm\/t\d+\/(inputs|namelists)\.json$/.test(name))
				result.push({ truncation, earthSurfaceClimatology, firstSnapshotMs: performance.now() - started, probe, inputs, step: snapshot.step, hash: hash >>> 0, finite: snapshot.values.every(Number.isFinite) })
			} finally { run?.stop() }
		}
		return result
	})
	assert(rows.every(row => row.finite))
	if (label !== "baseline") for (const row of rows) assert.deepEqual(row.inputs, [`/gcm/t${row.truncation}/${row.earthSurfaceClimatology ? "inputs" : "namelists"}.json`])
	await fs.writeFile(path.join(output, `${label}.json`), JSON.stringify(rows, null, 2))
	if (label !== "baseline") {
		const baseline = JSON.parse(await fs.readFile(path.join(output, "baseline.json"), "utf8"))
		assert.deepEqual(rows.map(({ step, hash }) => ({ step, hash })), baseline.map(({ step, hash }) => ({ step, hash })))
	}
	console.log(JSON.stringify(rows, null, 2))
} finally {
	await browser.close()
	await server.close()
}
