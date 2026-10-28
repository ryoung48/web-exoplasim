import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "vite"
import { readProbe } from "./probe.mjs"

const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const output = path.resolve("stats/exoplasim-webgpu/kernels")
await fs.mkdir(output, { recursive: true })
const CASES = ["earth-t21", "earth-t42", "alt1-t21", "orbit-t21"]
// f64 against f64: the port evaluates the same formulas with JavaScript's
// pow, log and summation order. 1e-12 relative to the array's largest value
// is about 4500 ulps, room for the short sums and the 10 x 10 inversions,
// and far below the 2^-24 rounding these tables get on upload.
const TOLERANCE = 1e-12

const server = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, watch: null }, appType: "custom", logLevel: "error" })
const report = { tolerance: TOLERANCE, cases: [] }
try {
	const { DYNAMICS_SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/dynamics/setup/index.ts"))
	const { GCM_GRID } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/grid/index.ts"))
	for (const name of CASES) {
		const dump = (point) => readProbe(path.join(probeRoot, `setup-${name}`, `probe-${point}`))
		const [before, after, step] = await Promise.all([dump("initpm-in"), dump("initsi-out"), dump("0-a0")])
		const scalar = (key) => before[key][0]
		const setup = DYNAMICS_SETUP.initpm({
			truncation: scalar("NTRU"),
			levels: scalar("NLEV"),
			neqsig: scalar("neqsig"),
			restim: before.restim,
			tfrc: before.tfrc,
			tdissd: before.tdissd,
			tdissz: before.tdissz,
			tdisst: before.tdisst,
			tdissq: before.tdissq,
			ndel: before.ndel,
			nhdiff: scalar("nhdiff"),
			dayLengthS: scalar("day_24hr"),
			stepsPerDay: scalar("mtspd"),
			t0: before.t0,
			dtns: scalar("dtns"),
			dtep: scalar("dtep"),
			dttrp: scalar("dttrp"),
			ct: scalar("ct"),
			akap: scalar("akap"),
		})
		const bm1 = DYNAMICS_SETUP.makebm({ setup, truncation: scalar("NTRU"), delt: step.delt[0] })
		const rcsq = DYNAMICS_SETUP.latitudeFactors({ grid: GCM_GRID.forLatitudes(scalar("NLAT")) })
		const pairs = {
			...Object.fromEntries(["sigmah", "sigma", "dsigma", "rdsig", "damp", "tfrc", "tdissd", "tdissz", "tdisst", "tdissq", "sak", "nindex", "spnorm", "t0", "tkp", "t01s2", "g", "c", "tau"].map((key) => [key, [setup[key], after[key]]])),
			...Object.fromEntries(["dtns", "dtep", "dttrp"].map((key) => [key, [[setup[key]], after[key]]])),
			bm1: [bm1, step.bm1],
			rcsq: [rcsq, step.rcsq],
			sakpp: [setup.sak, step.sakpp],
		}
		const arrays = {}
		for (const [key, [port, fortran]] of Object.entries(pairs)) {
			if (port.length !== fortran.length) throw new Error(`${name} ${key}: ${port.length} values, Fortran has ${fortran.length}`)
			let error = 0
			let scale = 0
			for (let i = 0; i < port.length; i++) {
				error = Math.max(error, Math.abs(port[i] - fortran[i]))
				scale = Math.max(scale, Math.abs(fortran[i]))
			}
			const relative = scale === 0 ? error : error / scale
			arrays[key] = { maxRelative: relative, pass: relative <= TOLERANCE }
		}
		const delt = step.delt[0]
		const entry = { case: name, delt, deltCheck: Math.abs(delt - (2 * 3.14159265359) / step.ntspd[0]), pass: Object.values(arrays).every((a) => a.pass), arrays }
		report.cases.push(entry)
		const worst = Object.entries(arrays).reduce((a, b) => (a[1].maxRelative > b[1].maxRelative ? a : b))
		console.log(`${name.padEnd(10)} ${entry.pass ? "pass" : "FAIL"}  worst ${worst[0]} ${worst[1].maxRelative.toExponential(2)}  ` + Object.entries(arrays).filter(([, a]) => !a.pass).map(([key, a]) => `${key}=${a.maxRelative.toExponential(2)}`).join(" "))
	}
} finally {
	await fs.writeFile(path.join(output, "setup.json"), JSON.stringify(report, null, 2))
	await server.close()
}
