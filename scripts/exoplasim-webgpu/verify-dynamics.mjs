import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { readProbe } from "./probe.mjs"

const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const output = path.resolve("stats/exoplasim-webgpu/kernels")
await fs.mkdir(output, { recursive: true })
// Main-loop steps, then the three nkits start-up steps (delt halved per
// remaining step, bm1 rebuilt by makebm, no leapfrog filter).
const CASES = [
	{ truncation: 21, steps: [100, 2000], dumps: "state", f32: "replay-f32", f64: "replay-f64", physics: true },
	{ truncation: 42, steps: [100, 500], dumps: "state", f32: "replay-f32", f64: "replay-f64", physics: true },
	{ truncation: 21, steps: ["kits3", "kits2", "kits1"], dumps: "kits", f32: "kits-replay-f32", f64: "kits-replay-f64", physics: false },
	{ truncation: 42, steps: ["kits3", "kits2", "kits1"], dumps: "kits", f32: "kits-replay-f32", f64: "kits-replay-f64", physics: false },
]
// Each routine runs from the f64 state dumped just before it; its outputs
// are compared with the f64 state after it and with the f32 build's replay
// of the same routine from the same (rounded) state.
const ROUTINES = [
	{ name: "gridpointa", before: "a0", after: "a1", outputs: ["sdt", "stt", "szt", "sqt", "spt", "gd", "gt", "gz", "gq", "gu", "gv", "gp", "gpj", "dw", "dp0", "du0", "dv0"] },
	{ name: "spectrala", before: "a1", after: "a2", outputs: ["sd", "st", "sz", "sq", "sp", "sdp", "stp", "szp", "sqp", "spp", "sdt", "stt", "spt", "sdm", "stm", "szm", "sqm", "spm"] },
	{ name: "spectrald", before: "a3", after: "a4", outputs: ["sd", "st", "sz", "sq", "sdp", "stp", "szp", "sqp", "sdt", "stt", "szt", "sqt", "sdm", "stm", "szm", "sqm", "spm"] },
	{ name: "physicsIn", physics: true, before: "a2", after: "d0", outputs: ["gu", "gv", "gt", "gp", "gq", "dp", "du", "dv", "dt", "dq", "gudt", "gvdt", "gtdt", "gqdt", "dudt", "dvdt", "dtdt", "dqdt"] },
	{ name: "fixer", physics: true, before: "d0", after: "d1", outputs: ["dq", "gqdt"] },
	// gp2fc transforms gudt..gqdt in place, so Fortran leaves Fourier
	// coefficients there; the GPU writes them to separate fields. gridpointd
	// zeroes them before their next use, so only the spectral tendencies count.
	{ name: "physicsOut", physics: true, before: "d6", after: "a3", outputs: ["sdt", "stt", "szt", "sqt"] },
]
const SCALARS = ["psurf", "ww", "cv", "ct", "akap", "rdbrv", "adv", "acpd", "ga", "plavor", "delt", "delt2", "deltsec2", "pnu", "pnu21", "nkits"]
const FILTER_SCALARS = ["nfilter", "ngptfilter", "nspvfilter", "filterkappa", "nfilterexp", "landhoskn0"]
// V3: a point counts as off when it differs from f64 by more than this
// fraction of the field's RMS (about 84 f32 ULPs, see the plan).
const POINT_TOLERANCE = 1e-5

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const { DYNAMICS } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/dynamics/index.ts"))
const { DYNAMICS_SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/dynamics/setup/index.ts"))
const { GCM_GRID: GRID } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/grid/index.ts"))
// Constants from the TypeScript set-up port (checked by verify-setup.mjs);
// sop and srp have no port yet and come from the dump.
async function portedTables({ truncation, delt }) {
	const input = await readProbe(path.join(probeRoot, `setup-earth-t${truncation}`, "probe-initpm-in"))
	const scalar = (key) => input[key][0]
	const setup = DYNAMICS_SETUP.initpm({ truncation, levels: scalar("NLEV"), neqsig: scalar("neqsig"), restim: input.restim, tfrc: input.tfrc, tdissd: input.tdissd, tdissz: input.tdissz, tdisst: input.tdisst, tdissq: input.tdissq, ndel: input.ndel, nhdiff: scalar("nhdiff"), dayLengthS: scalar("day_24hr"), stepsPerDay: scalar("mtspd"), t0: input.t0, dtns: scalar("dtns"), dtep: scalar("dtep"), dttrp: scalar("dttrp"), ct: scalar("ct"), akap: scalar("akap") })
	const tables = DYNAMICS_SETUP.tables({ setup, bm1: DYNAMICS_SETUP.makebm({ setup, truncation, delt }), rcsq: DYNAMICS_SETUP.latitudeFactors({ grid: GRID.forLatitudes(scalar("NLAT")) }) })
	return Object.fromEntries(Object.entries(tables).map(([name, values]) => [name, Array.from(values)]))
}
const { FIXER } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/physics/fixer/index.ts"))
const NEEDED = new Set([...DYNAMICS.fields(10), ...FIXER.fields(10)].map((field) => field.name).concat(DYNAMICS.TABLES.map((table) => table.name)))
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-unsafe-webgpu"] })
const report = { cases: [] }
try {
	const page = await browser.newPage()
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await page.goto(server.resolvedUrls.local[0])
	for (const { truncation, steps, ...kinds } of CASES) {
		const dumps = (kind, step, point) => readProbe(path.join(probeRoot, `${kind}-t${truncation}`, `probe-${step}-${point}`))
		for (const step of steps) {
			const f64 = Object.fromEntries(await Promise.all([...["a0", "a1", "a2", "a3", "a4"], ...(kinds.physics ? ["d0", "d1", "d6"] : [])].map(async (point) => [point, await dumps(kinds.dumps, step, point)])))
			const f32 = Object.fromEntries(await Promise.all([...["a1", "a2", "a4"], ...(kinds.physics ? ["d0", "d1", "a3"] : [])].map(async (point) => [point, await dumps(kinds.f32, step, point)])))
			const sanity = await dumps(kinds.f64, step, "a4")
			const replayExact = Object.keys(f64.a4).every((name) => f64.a4[name].every((value, i) => Object.is(value, sanity[name][i])))
			for (const routine of ROUTINES.filter((entry) => kinds.physics || !entry.physics)) {
				const before = f64[routine.before]
				const scalars = Object.fromEntries([...SCALARS, ...FILTER_SCALARS].map((name) => [name, before[name][0]]))
				const ported = await portedTables({ truncation, delt: scalars.delt })
				const gpu = await page.evaluate(async ({ truncation, before, ported, scalars, routine }) => {
					const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
					const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
					const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
					const { KERNEL } = await import("/src/model/climate/gcm/kernel/index.ts")
					const { FOURIER } = await import("/src/model/climate/gcm/fourier/index.ts")
					const { LEGENDRE } = await import("/src/model/climate/gcm/legendre/index.ts")
					const { DYNAMICS } = await import("/src/model/climate/gcm/dynamics/index.ts")
					const { FIXER } = await import("/src/model/climate/gcm/physics/fixer/index.ts")
					const latitudes = { 21: 32, 42: 64 }[truncation]
					const grid = GCM_GRID.forLatitudes(latitudes)
					const dimensions = { truncation, latitudes, longitudes: grid.longitudes, levels: 10 }
					const { device } = await GCM_DEVICE.request({ storageBytes: 0, onLost: () => {} })
					const state = LAYOUT.create({ dimensions, fields: [...DYNAMICS.fields(dimensions.levels), ...FIXER.fields(dimensions.levels)] })
					const filters = LEGENDRE.filters({ truncation, ...Object.fromEntries(["nfilter", "ngptfilter", "nspvfilter", "filterkappa", "nfilterexp", "landhoskn0"].map((name) => [name, scalars[name]])) })
					const fourier = FOURIER.tables({ longitudes: grid.longitudes, truncation })
					const tableValues = {
						fourier_forward: fourier.forward,
						fourier_inverse: fourier.inverse,
						...LEGENDRE.kernelTables({ tables: LEGENDRE.tables({ grid, truncation }), filters, truncation }),
						...FIXER.tables({ grid }),
						...Object.fromEntries(DYNAMICS.TABLES.map(({ name, count }) => {
							const values = ported[name] ?? before[name]
							if (values.length !== count(dimensions)) throw new Error(`${name}: ${values.length} values, expected ${count(dimensions)}`)
							return [name, Float64Array.from(values)]
						})),
					}
					const tables = LAYOUT.create({ dimensions, fields: LAYOUT.tableFields(tableValues) })
					const context = KERNEL.context({ device, state, tables })
					for (const [name, values] of Object.entries(tableValues)) LAYOUT.write({ device, buffer: context.tableBuffer, layout: tables, name, values: Float32Array.from(values) })
					for (const name of Object.keys(state.slots)) {
						if (before[name]) LAYOUT.write({ device, buffer: context.stateBuffer, layout: state, name, values: Float32Array.from(before[name]) })
					}
					const kernels = await DYNAMICS.kernels({
						context,
						constants: {
							psurf: scalars.psurf,
							ww: scalars.ww,
							cv: scalars.cv,
							ct: scalars.ct,
							akap: scalars.akap,
							rdbrv: scalars.rdbrv,
							adv: scalars.adv,
							acpd: scalars.acpd,
							ga: scalars.ga,
							plavor: scalars.plavor,
							delt: scalars.delt,
							delt2: scalars.delt2,
							deltsec2: scalars.deltsec2,
							pnu: scalars.pnu,
							pnu21: scalars.pnu21,
							filter: scalars.nkits === 0,
						},
					})
					const encoder = device.createCommandEncoder()
					const pass = encoder.beginComputePass()
					const lists = { ...kernels, fixer: await FIXER.kernels({ context, delt2: scalars.delt2, psurf: scalars.psurf }) }
					for (const kernel of lists[routine.name]) KERNEL.dispatch({ pass, context, kernel })
					pass.end()
					device.queue.submit([encoder.finish()])
					const result = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: state, names: routine.outputs })
					device.destroy()
					return Object.fromEntries(Object.entries(result).map(([name, values]) => [name, Array.from(values)]))
				}, { truncation, before: Object.fromEntries(Object.entries(before).filter(([name]) => NEEDED.has(name))), ported, scalars, routine })
				const fields = {}
				// On output and diagnostic steps gridpointa overwrites gp with the
				// Fourier coefficients of exp(ln ps) - 1 to compute span, which only
				// diagnostics read; invlegd rewrites gp before anything else uses it.
				const nstep = before.nstep[0]
				const diagnosticStep = nstep % before.nafter[0] === 0 || nstep % before.ndiag[0] === 0
				const skipped = routine.name === "gridpointa" && diagnosticStep ? ["gp"] : []
				for (const name of routine.outputs.filter((output) => !skipped.includes(output))) {
					const exact = f64[routine.after][name]
					const scale = rms(exact)
					const gpuError = rms(gpu[name], exact) / scale
					const f32Error = rms(f32[routine.after][name], exact) / scale
					const gpuOff = countOff(gpu[name], exact, scale)
					const f32Off = countOff(f32[routine.after][name], exact, scale)
					const pass = scale === 0 ? rms(gpu[name]) === 0 : gpuError <= 2 * f32Error && gpuOff <= 2 * f32Off + 1
					fields[name] = { gpuRelativeRms: gpuError, f32RelativeRms: f32Error, ratio: gpuError / f32Error, gpuPointsOff: gpuOff, f32PointsOff: f32Off, pass, ...(pass ? {} : { gpu: gpu[name], f64: exact, f32: f32[routine.after][name] }) }
				}
				const entry = { truncation, step, routine: routine.name, replayExact, skipped, pass: Object.values(fields).every((field) => field.pass), fields }
				report.cases.push(entry)
				console.log(`T${truncation} step ${step} ${routine.name.padEnd(10)} ${entry.pass ? "pass" : "FAIL"}  ` + Object.entries(fields).map(([name, f]) => `${name}=${f.ratio.toFixed(2)}${f.pass ? "" : "!"}`).join(" "))
			}
		}
	}
	report.errors = errors
	report.chrome = browser.version()
} finally {
	await fs.writeFile(path.join(output, "dynamics.json"), JSON.stringify(report, null, 2))
	await browser.close()
	await server.close()
}

function rms(values, reference) {
	let sum = 0
	for (let i = 0; i < values.length; i++) sum += (values[i] - (reference ? reference[i] : 0)) ** 2
	return Math.sqrt(sum / values.length)
}

function countOff(values, reference, scale) {
	let count = 0
	for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - reference[i]) > POINT_TOLERANCE * scale) count++
	return count
}
