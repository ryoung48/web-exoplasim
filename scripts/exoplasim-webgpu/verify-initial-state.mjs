import path from "node:path"
import { createServer } from "vite"
import { dumped, readInputs } from "./model-inputs.mjs"
import { readProbe } from "./probe.mjs"

// SETUP's initial state from the page's input files against the Fortran's
// after prolog: the first start-up step's a0 dump (kits3, counted down).
// Each field's worst error is relative to its largest magnitude.
const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const inputsRoot = path.resolve(process.argv[3] ?? "../../../stats/exoplasim-reference/inputs")
// inigau's trigonometric series loses a few ulps to cos/acos at T42 (2e-14
// in the Gaussian weights); everything else agrees to 1e-14.
const TOLERANCE = 1e-13
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
let failures = 0
try {
	const { SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/setup/index.ts"))
	for (const truncation of [21, 42]) {
		const files = await readInputs(path.join(inputsRoot, `earth-t${truncation}`))
		const dump = await readProbe(path.join(probeRoot, `kits-t${truncation}`, "probe-kits3-a0"))
		const state = SETUP.state({ truncation, levels: 10, namelists: files, clock: 0 })
		const fields = { ...state.fields, srp: state.fields.sr, so: state.so, sop: state.so }
		const rows = []
		for (const [name, values] of Object.entries(fields)) {
			const reference = dumped(dump, name)
			if (!reference) {
				failures++
				rows.push(`${name}: not in dump`)
				continue
			}
			const scale = reference.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0) || 1
			let worst = 0
			let at = 0
			let off = 0
			for (let i = 0; i < reference.length; i++) {
				const error = Math.abs(values[i] - reference[i]) / scale
				if (error > TOLERANCE) off++
				if (!(error <= worst)) [worst, at] = [error, i]
			}
			if (values.length !== reference.length || !(worst <= TOLERANCE)) {
				failures++
				rows.push(`${name}: worst ${worst.toExponential(1)} at ${at} (${values[at]} vs ${reference[at]}), ${off} off, ${values.length}/${reference.length} values`)
			}
		}
		console.log(`T${truncation}: ${Object.keys(fields).length} fields, ${rows.length} differ${rows.length ? `\n  ${rows.join("\n  ")}` : ""}`)
	}
} finally {
	await server.close()
}
process.exitCode = failures ? 1 : 0
