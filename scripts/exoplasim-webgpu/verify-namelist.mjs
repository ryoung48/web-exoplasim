import path from "node:path"
import { createServer } from "vite"
import { physicsTablesInputs, readInputs, stepCalendar, stepperConstants } from "./model-inputs.mjs"
import { readProbe } from "./probe.mjs"

// SETUP's values from the page's namelist text against the Fortran's at the
// same point: pumamod when initpm starts (the setup run's initpm-in dump),
// and SETUP.constants' kernel constants, calendar and table inputs against
// what the main loop runs with (constant after set-up).
const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const inputsRoot = path.resolve(process.argv[3] ?? "../../../stats/exoplasim-reference/inputs")
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
let failures = 0

// Every number or boolean in the reference against the port's.
function compareLeaves({ ported, reference, at, rows }) {
	if (typeof reference === "object" && reference !== null) {
		for (const key of Object.keys(reference)) compareLeaves({ ported: ported?.[key], reference: reference[key], at: `${at}.${key}`, rows })
		return
	}
	const error = typeof reference === "number" ? Math.abs(ported - reference) / (Math.abs(reference) || 1) : ported === reference ? 0 : 1
	if (!(error <= 1e-14)) rows.push(`${at}: ${ported} vs ${reference} (${error.toExponential(1)})`)
}
try {
	const { SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/setup/index.ts"))
	const { SPECTRUM } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/physics/radiation/spectrum/index.ts"))
	for (const truncation of [21, 42]) {
		const namelists = await readInputs(path.join(inputsRoot, `earth-t${truncation}`))
		const ported = SETUP.pumamod({ truncation, levels: 10, namelists })
		const dump = await readProbe(path.join(probeRoot, `setup-earth-t${truncation}`, "probe-initpm-in"))
		// The set-up dumps hold pumamod only; other modules' values come from a
		// main-loop dump (constant after set-up).
		const later = await readProbe(path.join(probeRoot, `state-t${truncation}`, "probe-100-a0"))
		const rows = []
		let spectrumWorst = 0
		for (const [name, value] of Object.entries(ported)) {
			// planet_ini also sets radmod's solar constant.
			const reference = dump[name] ?? later[`radmod.${name}`]
			if (!reference) {
				rows.push(`${name}: not in dump`)
				continue
			}
			const values = Array.isArray(value) ? value : [value]
			const worst = Math.max(...values.map((v, i) => Math.abs(v - reference[i]) / (Math.abs(reference[i]) || 1)))
			if (!(worst <= 1e-15)) {
				failures++
				rows.push(`${name}: ${values.slice(0, 3).join(",")} vs ${Array.from(reference.slice(0, 3)).join(",")} (${worst.toExponential(1)})`)
			}
		}
		// solarini, from the radmod namelist's star temperature.
		const spectrum = SPECTRUM.split({ starTemperatureK: later["radmod.starbbtemp"][0], minWavelengthM: later["radmod.minwavel"][0], simpleAlbedo: true })
		for (const [name, value] of Object.entries(spectrum)) {
			const reference = later[name] ?? later[`radmod.${name}`]
			const values = Array.isArray(value) ? value : [value]
			const worst = Math.max(...values.map((v, i) => Math.abs(v - reference[i]) / Math.abs(reference[i])))
			if (!(worst <= 1e-13)) {
				failures++
				rows.push(`${name}: ${values.join(",")} vs ${Array.from(reference).join(",")} (${worst.toExponential(1)})`)
			} else spectrumWorst = Math.max(spectrumWorst, worst)
		}
		const setup = SETUP.constants({ truncation, levels: 10, namelists, meanOrography: SETUP.state({ truncation, levels: 10, namelists, clock: 0 }).so[0], kits: 0 })
		const constantRows = []
		compareLeaves({ ported: setup.stepper, reference: stepperConstants(later), at: "stepper", rows: constantRows })
		compareLeaves({ ported: setup.calendar, reference: stepCalendar(later).calendar, at: "calendar", rows: constantRows })
		compareLeaves({ ported: setup.tables, reference: physicsTablesInputs({ truncation, dump: later }), at: "tables", rows: constantRows })
		compareLeaves({ ported: setup.co2, reference: later.co2[0], at: "co2", rows: constantRows })
		failures += constantRows.length
		console.log(`T${truncation} constants: ${constantRows.length} differ${constantRows.length ? `\n  ${constantRows.join("\n  ")}` : ""}`)
		console.log(`T${truncation}: ${Object.keys(ported).length + Object.keys(spectrum).length} values, ${rows.length} differ or missing; spectrum worst ${spectrumWorst.toExponential(1)}${rows.length ? `\n  ${rows.join("\n  ")}` : ""}`)
	}
} finally {
	await server.close()
}
process.exitCode = failures ? 1 : 0
