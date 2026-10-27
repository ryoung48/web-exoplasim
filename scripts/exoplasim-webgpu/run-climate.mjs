import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "vite"
import { readInputs } from "./model-inputs.mjs"
import { openPage } from "./trajectory.mjs"

// V5: the GPU model run headless from a fresh start, writing the annual
// zonal means gcm_reference.f90 writes (same 9 fields, every main step,
// one record per model year) for compare-climate.mjs.
// Usage: node run-climate.mjs <truncation> <years> [inputs] [output]
const truncation = Number(process.argv[2] ?? 21)
const years = Number(process.argv[3] ?? 15)
const inputs = path.resolve(process.argv[4] ?? `../../../stats/exoplasim-reference/inputs/earth-t${truncation}`)
const output = path.resolve(process.argv[5] ?? `stats/exoplasim-webgpu/climate/t${truncation}`)
await fs.mkdir(output, { recursive: true })

// gcm_reference.f90's fields, read from the state after each main step.
const ACCUMULATE = `
@group(1) @binding(0) var<storage, read_write> sums: array<f32>;
const L_TIMES_RHOH2O: f32 = -333700000.0;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let surface = NLEV * NHOR + h;
	sums[h] += state[DT + surface];
	sums[NHOR + h] += state[DTSA + h];
	sums[2u * NHOR + h] += state[DPRC + h] + state[DPRL + h];
	sums[3u * NHOR + h] += state[DCC + surface];
	sums[4u * NHOR + h] += -state[DLWFL + h];
	sums[5u * NHOR + h] += state[DSWFL + h] + state[DLWFL + h];
	sums[6u * NHOR + h] += state[DP + h];
	sums[7u * NHOR + h] += state[DSMELT + h] * L_TIMES_RHOH2O + state[DSWFL + surface] + state[DLWFL + surface] + state[DSHFL + h] + state[DLHFL + h];
	sums[8u * NHOR + h] += state[DICEC + h];
}`
const FIELDS = 9

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const { browser, page, errors } = await openPage(server)
page.on("console", (message) => message.type() === "log" && console.log(message.text()))
const started = performance.now()
try {
	const namelists = await readInputs(inputs)
	const result = await page.evaluate(async ({ truncation, years, namelists, code, fields }) => {
		const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
		const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
		const { KERNEL } = await import("/src/model/climate/gcm/kernel/index.ts")
		const { SETUP } = await import("/src/model/climate/gcm/setup/index.ts")
		const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
		const request = { truncation, levels: 10, namelists }
		const initial = SETUP.state({ ...request, clock: 0 })
		const schedule = SETUP.schedule({ request, state: initial })
		const latitudes = { 21: 32, 42: 64 }[truncation]
		const longitudes = 2 * latitudes
		const points = latitudes * longitudes
		const dimensions = { truncation, latitudes, longitudes, levels: 10 }
		const { device, adapter } = await GCM_DEVICE.request({ storageBytes: 0, onLost: () => {} })
		const context = STEPPER.context({ device, dimensions, tables: schedule.tables })
		const write = ({ name, values }) => LAYOUT.write({ device, buffer: context.stateBuffer, layout: context.state, name, values: Float32Array.from(values) })
		for (const [name, values] of Object.entries(initial.fields)) if (context.state.slots[name]) write({ name, values })
		const writeTable = (values) => LAYOUT.write({ device, buffer: context.tableBuffer, layout: context.tables, name: "bm1", values: Float32Array.from(values) })

		// The accumulation kernel: the model's bindings as group 0 (a layout
		// equivalent to the context's), the sums as group 1.
		const storage = (binding, type) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })
		const modelLayout = device.createBindGroupLayout({ entries: [storage(0, "storage"), storage(1, "read-only-storage")] })
		const sumsLayout = device.createBindGroupLayout({ entries: [storage(0, "storage")] })
		const bytes = fields * points * 4
		const sums = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
		const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
		const accumulate = await device.createComputePipelineAsync({
			label: "climate sums",
			layout: device.createPipelineLayout({ bindGroupLayouts: [modelLayout, sumsLayout] }),
			compute: { module: device.createShaderModule({ code: `${context.header}\n${code}` }), entryPoint: "main", constants: { THREADS: points } },
		})
		const sumsGroup = device.createBindGroup({ layout: sumsLayout, entries: [{ binding: 0, resource: { buffer: sums } }] })

		const startupKernels = await Promise.all(schedule.startup.map((phase) => STEPPER.kernels({ context, constants: phase.stepper })))
		const mainKernels = await STEPPER.kernels({ context, constants: schedule.main.stepper })
		let counter = 0
		const step = ({ kernels, at, sample }) => {
			const values = STEPPER.values({ step: at, carbonStep: counter, calendar: schedule.calendar })
			counter = values.carbonStep
			for (const [name, field] of Object.entries(values.fields)) write({ name, values: field })
			const encoder = device.createCommandEncoder()
			const pass = encoder.beginComputePass()
			STEPPER.encode({ pass, context, kernels })
			if (sample) {
				pass.setPipeline(accumulate)
				pass.setBindGroup(0, context.bindGroup)
				pass.setBindGroup(1, sumsGroup)
				pass.dispatchWorkgroups(Math.ceil(points / 64))
			}
			pass.end()
			return encoder
		}
		schedule.startup.forEach((phase, p) => {
			writeTable(phase.bm1)
			device.queue.submit([step({ kernels: startupKernels[p], at: schedule.startStep, sample: false }).finish()])
		})
		writeTable(schedule.main.bm1)

		const perDay = schedule.calendar.stepsPerDay
		const perYear = perDay * schedule.calendar.daysPerYear
		const yearSums = new Float64Array(fields * points)
		const records = []
		const clock = performance.now()
		for (let k = 0; k < years * perYear; k++) {
			const encoder = step({ kernels: mainKernels, at: schedule.startStep + k, sample: true })
			if ((k + 1) % perDay !== 0) {
				device.queue.submit([encoder.finish()])
				continue
			}
			encoder.copyBufferToBuffer(sums, 0, staging, 0, bytes)
			encoder.clearBuffer(sums)
			device.queue.submit([encoder.finish()])
			await staging.mapAsync(GPUMapMode.READ)
			const day = new Float32Array(staging.getMappedRange())
			for (let i = 0; i < day.length; i++) yearSums[i] += day[i]
			staging.unmap()
			if (!yearSums.every(Number.isFinite)) return { records, adapterInfo: adapter.description || adapter.vendor, failed: `non-finite sums by step ${k + 1}` }
			if ((k + 1) % perYear !== 0) continue
			const zonal = []
			for (let f = 0; f < fields; f++)
				for (let lat = 0; lat < latitudes; lat++) {
					let total = 0
					for (let lon = 0; lon < longitudes; lon++) total += yearSums[f * points + lat * longitudes + lon]
					zonal.push(total / (longitudes * perYear))
				}
			records.push({ year: records.length + 2, samples: perYear, zonal })
			yearSums.fill(0)
			const seconds = (performance.now() - clock) / 1000
			console.log(`year ${records.length}/${years}: ${(seconds / records.length).toFixed(1)} s/year, mean Ts ${(zonal.slice(0, latitudes).reduce((a, b) => a + b, 0) / latitudes).toFixed(2)} K (unweighted)`)
		}
		device.destroy()
		return { records, adapterInfo: `${adapter.vendor} ${adapter.architecture}`, failed: null, dispatchesPerStep: mainKernels.length }
	}, { truncation, years, namelists, code: ACCUMULATE, fields: FIELDS })
	const text = result.records.map(({ year, samples, zonal }) => {
		const lines = [`${String(year).padStart(6)} ${String(samples).padStart(8)} ${String(FIELDS).padStart(4)} ${String(zonal.length / FIELDS).padStart(4)}`]
		for (let i = 0; i < zonal.length; i += 4) lines.push(zonal.slice(i, i + 4).map((value) => value.toExponential(16).padStart(24)).join(" "))
		return lines.join("\n")
	})
	await fs.writeFile(path.join(output, "reference-means.txt"), `${text.join("\n")}\n`)
	const seconds = (performance.now() - started) / 1000
	await fs.writeFile(path.join(output, "run.json"), JSON.stringify({ engine: "webgpu", truncation, years: result.records.length, requestedYears: years, failed: result.failed, inputs, dispatchesPerStep: result.dispatchesPerStep, adapter: result.adapterInfo, chrome: browser.version(), elapsedSeconds: seconds, errors }, null, 2))
	console.log(`${result.records.length} years in ${seconds.toFixed(0)} s${result.failed ? `; stopped: ${result.failed}` : ""}${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}`)
} finally {
	await browser.close()
	await server.close()
}
