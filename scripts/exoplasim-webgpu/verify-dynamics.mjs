import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { dumped, loadModules, stepCalendar, stepperConstants, dynamicsConstants, tablesInputs } from "./model-inputs.mjs"
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
	{ name: "surfaceFlux", physics: true, before: "d1", after: "d2", outputs: ["dtdt", "dqdt", "dudt", "dvdt", "dtaux", "dtauy", "dust3", "dshfl", "dshdt", "devap", "dlhfl", "dlhdt", "dtsa", "dtransh", "dtransm"] },
	{ name: "radiation", physics: true, before: "d2", after: "d3", outputs: ["gmu0", "dqo3", "dtdt", "dalb", "dsalb", "dfu", "dfd", "dswfl", "dftu", "dftd", "dlwfl", "dflux", "dtdtswr", "dtdtlwr", "dconv"] },
	{ name: "precipitation", physics: true, before: "d3", after: "d4", outputs: ["dqt", "dtdt", "dqdt", "dcc", "dql", "dprc", "dprl", "dprs", "dqvi", "icclev", "icctot", "dprcl", "dprll"] },
	{
		name: "surface",
		physics: true,
		before: "d4",
		after: "d5",
		outputs: [
			...["dt", "dq", "dalb", "dsalb", "drhs", "dz0", "diced", "dicec", "dwmax", "dwatc", "drunoff", "dsnow", "dsmelt", "dsndch"],
			...["dtsoil", "dtd2", "dtd3", "dtd4", "dtd5", "dmld", "dglac", "dforest"],
			...["land_dts", "land_dtsm", "land_dqs", "driver", "dsoilt", "dsnowt", "dsnowz", "dwater", "dalbclim"],
			...["dcveg", "dcsoil", "dlai", "dvsoil"],
			...["xts", "xsst", "xiced", "xicec", "xsnow", "xicecc", "xcflux", "xqmelt", "xclsst2", "xclicec2", "xcliced2", "xclssto", "xoheat", "xoflux"],
			...["ysst", "yclsst2", "sea_dts", "sea_dqs", "sea_dsst"],
		],
	},
	{ name: "carbon", physics: true, before: "d5", after: "d6", outputs: ["localprecip", "localavgprecip", "localweathering", "localavgweather", "localavgtemps"] },
	// gp2fc transforms gudt..gqdt in place, so Fortran leaves Fourier
	// coefficients there; the GPU writes them to separate fields. gridpointd
	// zeroes them before their next use, so only the spectral tendencies count.
	{ name: "physicsOut", physics: true, before: "d6", after: "a3", outputs: ["sdt", "stt", "szt", "sqt"] },
]
// ROUTINES=fixer,surfaceFlux runs only those routines.
const ONLY = process.env.ROUTINES?.split(",")
// V3: a point counts as off when it differs from f64 by more than this
// fraction of the field's RMS (about 84 f32 ULPs, see the plan).
const POINT_TOLERANCE = 1e-5
// Above this share of a field's squared GPU error, one column is an
// outlier: more than all other columns together.
const OUTLIER_SHARE = 0.5
const POINTS = { 21: 64 * 32, 42: 128 * 64 }

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const modules = await loadModules(server)
const STATE_FIELDS = modules.STEPPER.fields(10)
const NEEDED = new Set(STATE_FIELDS.map((field) => field.name).concat(modules.DYNAMICS.TABLES.map((table) => table.name)))
const GRID_FIELDS = new Set(STATE_FIELDS.filter((field) => field.shape === "grid").map((field) => field.name))

// The CPU's orbit (CALENDAR) against what solang leaves in the dump.
function orbitError({ before, after }) {
	const { step, calendar } = stepCalendar(before)
	const solar = modules.CALENDAR.solar({ step, stepsPerYear: calendar.stepsPerYear, stepsPerDay: calendar.stepsPerDay, stepMinutes: calendar.stepMinutes, orbit: calendar.orbit })
	const expected = { calendarDay: "radmod.zcdayf", declination: "radmod.zdeclf", distanceFactor: "radmod.gdist2", trueAnomaly: "radmod.orbnu", longitude: "radmod.lambm", rightAscension: "radmod.rasc" }
	return Math.max(...Object.entries(expected).map(([key, name]) => Math.abs(solar[key] - after[name][0])))
}

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
			const f64 = Object.fromEntries(await Promise.all([...["a0", "a1", "a2", "a3", "a4"], ...(kinds.physics ? ["d0", "d1", "d2", "d3", "d4", "d5", "d6"] : [])].map(async (point) => [point, await dumps(kinds.dumps, step, point)])))
			const f32 = Object.fromEntries(await Promise.all([...["a1", "a2", "a4"], ...(kinds.physics ? ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "a3"] : [])].map(async (point) => [point, await dumps(kinds.f32, step, point)])))
			const sanity = await dumps(kinds.f64, step, "a4")
			const replayExact = Object.keys(f64.a4).every((name) => f64.a4[name].every((value, i) => Object.is(value, sanity[name][i])))
			for (const routine of ROUTINES.filter((entry) => (kinds.physics || !entry.physics) && (!ONLY || ONLY.includes(entry.name)))) {
				const before = f64[routine.before]
				const tables = await tablesInputs({ modules, probeRoot, truncation, dump: before })
				// Start-up dumps predate the physics modules' variables.
				const constants = kinds.physics ? stepperConstants(before) : { dynamics: dynamicsConstants(before) }
				const values = kinds.physics ? modules.STEPPER.values(stepCalendar(before)) : null
				if (routine.name === "carbon" && values.carbonStep !== f64.d6["carbonmod.cstep"][0]) throw new Error(`carbon counter ${values.carbonStep}, dump ${f64.d6["carbonmod.cstep"][0]}`)
				const stepFields = values ? Object.fromEntries(Object.entries(values.fields).map(([name, field]) => [name, Array.from(field)])) : {}
				const gpu = await page.evaluate(async ({ truncation, before, tables, constants, stepFields, routine }) => {
					const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
					const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
					const { KERNEL } = await import("/src/model/climate/gcm/kernel/index.ts")
					const { STEPPER } = await import("/src/model/climate/gcm/stepper/index.ts")
					const { DYNAMICS } = await import("/src/model/climate/gcm/dynamics/index.ts")
					const { FIXER } = await import("/src/model/climate/gcm/physics/fixer/index.ts")
					const { SURFACE_FLUX } = await import("/src/model/climate/gcm/physics/surface-flux/index.ts")
					const { RADIATION } = await import("/src/model/climate/gcm/physics/radiation/index.ts")
					const { PRECIPITATION } = await import("/src/model/climate/gcm/physics/precipitation/index.ts")
					const { SURFACE } = await import("/src/model/climate/gcm/physics/surface/index.ts")
					const { CARBON } = await import("/src/model/climate/gcm/physics/carbon/index.ts")
					const latitudes = { 21: 32, 42: 64 }[truncation]
					const dimensions = { truncation, latitudes, longitudes: 2 * latitudes, levels: 10 }
					const { device } = await GCM_DEVICE.request({ storageBytes: 0, onLost: () => {} })
					const context = STEPPER.context({ device, dimensions, tables })
					const state = context.state
					for (const name of Object.keys(state.slots)) {
						const values = before[name] ?? stepFields[name]
						if (values) LAYOUT.write({ device, buffer: context.stateBuffer, layout: state, name, values: Float32Array.from(values) })
					}
					const lists = {
						fixer: () => FIXER.kernels({ context, ...constants.fixer }),
						surfaceFlux: () => SURFACE_FLUX.kernels({ context, constants: constants.surfaceFlux }),
						radiation: () => RADIATION.kernels({ context, constants: constants.radiation }),
						precipitation: () => PRECIPITATION.kernels({ context, constants: constants.precipitation }),
						surface: () => SURFACE.kernels({ context, constants: constants.surface }),
						carbon: () => CARBON.kernels({ context, constants: constants.carbon }),
					}
					const list = lists[routine.name] ? await lists[routine.name]() : (await DYNAMICS.kernels({ context, constants: constants.dynamics }))[routine.name]
					const encoder = device.createCommandEncoder()
					const pass = encoder.beginComputePass()
					for (const kernel of list) KERNEL.dispatch({ pass, context, kernel })
					pass.end()
					device.queue.submit([encoder.finish()])
					const result = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: state, names: routine.outputs })
					device.destroy()
					return Object.fromEntries(Object.entries(result).map(([name, values]) => [name, Array.from(values)]))
				}, { truncation, before: Object.fromEntries([...NEEDED].filter((name) => dumped(before, name)).map((name) => [name, dumped(before, name)])), tables, constants, stepFields, routine })
				const fields = {}
				// On output and diagnostic steps gridpointa overwrites gp with the
				// Fourier coefficients of exp(ln ps) - 1 to compute span, which only
				// diagnostics read; invlegd rewrites gp before anything else uses it.
				const nstep = before.nstep[0]
				const diagnosticStep = nstep % before.nafter[0] === 0 || nstep % before.ndiag[0] === 0
				const skipped = routine.name === "gridpointa" && diagnosticStep ? ["gp"] : []
				for (const name of routine.outputs.filter((output) => !skipped.includes(output))) {
					const exact = dumped(f64[routine.after], name)
					const scale = rms(exact)
					const gpuError = rms(gpu[name], exact) / scale
					const f32Values = dumped(f32[routine.after], name)
					const f32Error = rms(f32Values, exact) / scale
					const gpuOff = countOff(gpu[name], exact, scale)
					const f32Off = countOff(f32Values, exact, scale)
					let pass = scale === 0 ? rms(gpu[name]) === 0 : withinGate({ gpuError, f32Error, gpuOff, f32Off })
					const outlier = !pass && scale !== 0 && GRID_FIELDS.has(name) ? dominantColumn({ gpu: gpu[name], exact, f32: f32Values, scale, points: POINTS[truncation] }) : null
					if (outlier) pass = withinGate(outlier)
					fields[name] = { gpuRelativeRms: gpuError, f32RelativeRms: f32Error, ratio: gpuError / f32Error, gpuPointsOff: gpuOff, f32PointsOff: f32Off, pass, ...(outlier ? { outlier } : {}), ...(pass && !process.env.KEEP_VALUES ? {} : { gpu: gpu[name], f64: exact, f32: f32Values }) }
				}
				const entry = { truncation, step, routine: routine.name, replayExact, skipped, ...(routine.name === "radiation" ? { orbitError: orbitError({ before, after: f64.d3 }) } : {}), pass: Object.values(fields).every((field) => field.pass), fields }
				report.cases.push(entry)
				console.log(`T${truncation} step ${step} ${routine.name.padEnd(10)} ${entry.pass ? "pass" : "FAIL"}  ` + Object.entries(fields).map(([name, f]) => `${name}=${f.ratio.toFixed(2)}${f.outlier ? `(column ${f.outlier.column}: ${f.outlier.ratio.toFixed(2)} without)` : ""}${f.pass ? "" : "!"}`).join(" "))
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

function withinGate({ gpuError, f32Error, gpuOff, f32Off }) {
	return gpuError <= 2 * f32Error && gpuOff <= 2 * f32Off + 1
}

// Outlier rule: a grid field that fails the gate because one column holds
// more than OUTLIER_SHARE of the GPU's squared error is judged again
// without that column, and the column is reported. Ill-conditioned columns
// (kuo's barely buoyant parcels) turn a 1-ULP rounding coin flip into a
// field's whole RMS.
function dominantColumn({ gpu, exact, f32, scale, points }) {
	const shares = new Float64Array(points)
	let total = 0
	for (let i = 0; i < gpu.length; i++) {
		const square = (gpu[i] - exact[i]) ** 2
		shares[i % points] += square
		total += square
	}
	const column = shares.indexOf(Math.max(...shares))
	const share = shares[column] / total
	if (!(share > OUTLIER_SHARE)) return null
	const keep = (_, i) => i % points !== column
	const [g, e, s] = [gpu, exact, f32].map((values) => Array.prototype.filter.call(values, keep))
	const gpuError = rms(g, e) / scale
	const f32Error = rms(s, e) / scale
	return { column, share, gpuError, f32Error, ratio: gpuError / f32Error, gpuOff: countOff(g, e, scale), f32Off: countOff(s, e, scale) }
}

function countOff(values, reference, scale) {
	let count = 0
	for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - reference[i]) > POINT_TOLERANCE * scale) count++
	return count
}
