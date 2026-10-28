import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"
import { readProbe } from "./probe.mjs"

const probeRoot = path.resolve(process.argv[2] ?? "stats/exoplasim-reference/probe")
const output = path.resolve("stats/exoplasim-webgpu/kernels")
await fs.mkdir(output, { recursive: true })

const probes = {
	21: await readProbe(path.join(probeRoot, "tables-t21", "probe-tables")),
	42: await readProbe(path.join(probeRoot, "tables-t42", "probe-tables")),
}
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
await server.listen()
const browser = await chromium.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--enable-unsafe-webgpu"],
})
try {
	const page = await browser.newPage()
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await page.goto(server.resolvedUrls.local[0])
	const results = await page.evaluate(async (probes) => {
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const { GCM_DEVICE } = await import("/src/model/climate/gcm/device/index.ts")
		const { LAYOUT } = await import("/src/model/climate/gcm/layout/index.ts")
		const { KERNEL } = await import("/src/model/climate/gcm/kernel/index.ts")
		const { FOURIER } = await import("/src/model/climate/gcm/fourier/index.ts")
		const { LEGENDRE } = await import("/src/model/climate/gcm/legendre/index.ts")
		const PLANES = 10
		// Any value exercises dv2uv's mode (0, 1) correction; PlaSim's is
		// 2 Omega / sqrt(3/2) scaled, set by initpm.
		const PLAVOR = 0.3
		// Page defaults: exponential physics filter on both directions
		// (FILTERKAPPA 8, NFILTEREXP 8, LANDHOSKN0 15), see namelist/index.ts.
		const FILTER = { nfilter: 2, ngptfilter: 1, nspvfilter: 1, filterkappa: 8, nfilterexp: 8, landhoskn0: 15 }
		const f = Math.fround
		const exact = (x) => x
		const maxRelative = (a, b) => {
			let error = 0
			let scale = 0
			for (let i = 0; i < a.length; i++) {
				error = Math.max(error, Math.abs(a[i] - b[i]))
				scale = Math.max(scale, Math.abs(b[i]))
			}
			return error / scale
		}
		const rms = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - (b ? b[i] : 0)) ** 2, 0) / a.length)
		const lost = []
		const { device, adapter } = await GCM_DEVICE.request({ storageBytes: 0, onLost: (message) => lost.push(message) })
		const report = { adapter: `${adapter.vendor} ${adapter.architecture}`, lost }
		for (const truncation of [21, 42]) {
			const probe = probes[truncation]
			const latitudes = { 21: 32, 42: 64 }[truncation]
			const grid = GCM_GRID.forLatitudes(latitudes)
			const N = grid.longitudes
			const NFC = 2 * (truncation + 1)
			const NCSP = ((truncation + 1) * (truncation + 2)) / 2
			const modeOf = []
			for (let m = 0; m <= truncation; m++) for (let n = m; n <= truncation; n++) modeOf.push([m, n])
			const legendre = LEGENDRE.tables({ grid, truncation })
			const filters = LEGENDRE.filters({ truncation, ...FILTER })
			const fourier = FOURIER.tables({ longitudes: N, truncation })
			const checks = {}
			for (const name of ["qi", "qj", "qc", "qe", "qm", "qq", "qu", "qv"]) checks[`table ${name}`] = maxRelative(legendre[name], probe[name])
			checks["table sid"] = maxRelative(grid.latitudeSines, probe.sid)
			checks["table gwd"] = maxRelative(grid.latitudeWeights, probe.gwd)
			checks["filter gp->sp"] = maxRelative(filters.gridToSpectral, probe.skgpsp)
			checks["filter sp->gp"] = maxRelative(filters.spectralToGrid, probe.skspgp)
			const pairs = { gp2fc: [[], []], fc2gp: [[], []] }
			for (let j = 0; j < N; j++)
				for (let k = 0; k < NFC; k++) {
					pairs.gp2fc[0].push(fourier.forward[j * NFC + k])
					pairs.gp2fc[1].push(probe.gp2fc[j * N + k])
					pairs.fc2gp[0].push(fourier.inverse[k * N + j])
					pairs.fc2gp[1].push(k === 1 ? 0 : probe.fc2gp[k * N + j])
				}
			checks["table gp2fc"] = maxRelative(...pairs.gp2fc)
			checks["table fc2gp"] = maxRelative(...pairs.fc2gp)

			const spectralFields = ["sp", "sp2", "sd", "sz", "d1", "z1", "q1", "d2", "t2", "z2"]
			const fourierFields = ["fc", "fc2", "gu", "gv", "fu", "fv", "ke", "tn", "ut", "vt", "qn", "uq", "vq"]
			const dimensions = { truncation, latitudes, longitudes: N, levels: PLANES }
			const state = LAYOUT.create({
				dimensions,
				fields: [
					...spectralFields.map((name) => ({ name, shape: "spectral", count: PLANES })),
					...fourierFields.map((name) => ({ name, shape: "fourier", count: PLANES })),
					{ name: "gp", shape: "grid", count: PLANES },
				],
			})
			const tableValues = {
				fourier_forward: fourier.forward,
				fourier_inverse: fourier.inverse,
				...LEGENDRE.kernelTables({ tables: legendre, filters, truncation }),
			}
			const tableLayout = LAYOUT.create({ dimensions, fields: LAYOUT.tableFields(tableValues) })
			const context = KERNEL.context({ device, state, tables: tableLayout })
			for (const [name, values] of Object.entries(tableValues)) LAYOUT.write({ device, buffer: context.tableBuffer, layout: tableLayout, name, values: Float32Array.from(values) })
			let seed = truncation
			const random = () => {
				seed = (seed * 1103515245 + 12345) % 2147483648
				return seed / 2147483648 - 0.5
			}
			const randomSpectral = () => {
				const values = new Float32Array(PLANES * 2 * NCSP)
				for (let p = 0; p < PLANES; p++)
					for (let w = 0; w < NCSP; w++) {
						values[p * 2 * NCSP + 2 * w] = random()
						values[p * 2 * NCSP + 2 * w + 1] = w <= truncation ? 0 : random()
					}
				return values
			}
			const randomFourier = () => {
				const values = new Float32Array(PLANES * latitudes * NFC)
				for (let row = 0; row < PLANES * latitudes; row++) for (let k = 0; k < NFC; k++) values[row * NFC + k] = k === 1 ? 0 : random()
				return values
			}
			for (const name of ["sp", "sd", "sz"]) LAYOUT.write({ device, buffer: context.stateBuffer, layout: state, name, values: randomSpectral() })
			for (const name of ["fu", "fv", "ke", "tn", "ut", "vt", "qn", "uq", "vq"]) LAYOUT.write({ device, buffer: context.stateBuffer, layout: state, name, values: randomFourier() })
			const kernels = [
				await LEGENDRE.inverse({ context, source: "sp", target: "fc", planes: PLANES, table: "legendre_qi" }),
				await FOURIER.inverse({ context, source: "fc", target: "gp", planes: PLANES }),
				await FOURIER.forward({ context, source: "gp", target: "fc2", planes: PLANES }),
				await LEGENDRE.forward({ context, source: "fc2", target: "sp2", planes: PLANES, table: "legendre_qc" }),
				await LEGENDRE.dv2uv({ context, divergence: "sd", vorticity: "sz", u: "gu", v: "gv", planes: PLANES, plavor: PLAVOR }),
				await LEGENDRE.uv2dv({ context, u: "fu", v: "fv", kinetic: null, divergence: "d1", vorticity: "z1", planes: PLANES }),
				await LEGENDRE.qtend({ context, uFlux: "uq", vFlux: "vq", source: "qn", target: "q1", planes: PLANES }),
				...(await LEGENDRE.mktend({ context, tn: "tn", fu: "fu", fv: "fv", ke: "ke", ut: "ut", vt: "vt", d: "d2", t: "t2", z: "z2", planes: PLANES })),
			]
			const encoder = device.createCommandEncoder()
			const pass = encoder.beginComputePass()
			for (const kernel of kernels) KERNEL.dispatch({ pass, context, kernel })
			pass.end()
			device.queue.submit([encoder.finish()])
			const gpu = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: state, names: [...spectralFields, ...fourierFields, "gp"] })

			// legmod.f90's loops with the probe's tables and filters. Each term is
			// [sign, table, input, part, combine]; combine "S" is north + s south
			// and "D" north - s south (s = +1 for even m + n), as in the
			// single-process branches. Terms accumulate in Fortran's order.
			const toSpectral = (inputs, outputs, round) => {
				const result = Object.fromEntries(Object.keys(outputs).map((name) => [name, new Float64Array(PLANES * 2 * NCSP)]))
				for (let p = 0; p < PLANES; p++)
					for (let l = 0; l < latitudes / 2; l++)
						modeOf.forEach(([m, n], w) => {
							const s = (m + n) % 2 === 0 ? 1 : -1
							for (const [name, parts] of Object.entries(outputs))
								parts.forEach((terms, c) => {
									const at = p * 2 * NCSP + 2 * w + c
									let acc = result[name][at]
									for (const [sign, table, input, part, combine] of terms) {
										const north = inputs[input][(p * latitudes + l) * NFC + 2 * m + part]
										const south = inputs[input][(p * latitudes + latitudes - 1 - l) * NFC + 2 * m + part]
										const mixed = round(combine === "S" ? north + s * south : north - s * south)
										acc = round(acc + sign * round(round(probe[table][l * NCSP + w] * mixed) * probe.skgpsp[n]))
									}
									result[name][at] = acc
								})
						})
				return result
			}
			const toFourier = (inputs, outputs, round) => {
				const result = Object.fromEntries(Object.keys(outputs).map((name) => [name, new Float64Array(PLANES * latitudes * NFC)]))
				for (let p = 0; p < PLANES; p++)
					for (let l = 0; l < latitudes; l++)
						modeOf.forEach(([m, n], w) => {
							for (const [name, parts] of Object.entries(outputs))
								parts.forEach((terms, c) => {
									const at = (p * latitudes + l) * NFC + 2 * m + c
									let acc = result[name][at]
									for (const [sign, table, input, part] of terms) {
										let value = inputs[input][p * 2 * NCSP + 2 * w + part]
										if (input === "sz" && w === 1 && part === 0) value = round(value - PLAVOR)
										acc = round(acc + sign * round(round(probe[table][l * NCSP + w] * value) * probe.skspgp[n]))
									}
									result[name][at] = acc
								})
						})
				return result
			}
			const dense = (input, rows, from, to, matrix, skip, round) => {
				const out = new Float64Array(rows * to)
				for (let row = 0; row < rows; row++)
					for (let k = 0; k < to; k++) {
						let sum = 0
						for (let j = 0; j < from; j++) if (j !== skip) sum = round(sum + round(matrix(j, k) * input[row * from + j]))
						out[row * to + k] = sum
					}
				return out
			}
			const rows = PLANES * latitudes
			const operators = [
				["sp2fc", ["fc"], (x, r) => toFourier(x, { fc: [[[1, "qi", "sp", 0]], [[1, "qi", "sp", 1]]] }, r)],
				["fc2gp", ["gp"], (x, r) => ({ gp: dense(x.fc, rows, NFC, N, (k, j) => probe.fc2gp[k * N + j], 1, r) })],
				["gp2fc", ["fc2"], (x, r) => ({ fc2: dense(x.gp, rows, N, NFC, (j, k) => probe.gp2fc[j * N + k], -1, r) })],
				["fc2sp", ["sp2"], (x, r) => toSpectral({ fc: x.fc2 }, { sp2: [[[1, "qc", "fc", 0, "S"]], [[1, "qc", "fc", 1, "S"]]] }, r)],
				[
					"dv2uv",
					["gu", "gv"],
					(x, r) =>
						toFourier(x, {
							gu: [
								[[1, "qv", "sz", 0], [1, "qu", "sd", 1]],
								[[1, "qv", "sz", 1], [-1, "qu", "sd", 0]],
							],
							gv: [
								[[1, "qu", "sz", 1], [-1, "qv", "sd", 0]],
								[[-1, "qu", "sz", 0], [-1, "qv", "sd", 1]],
							],
						}, r),
				],
				[
					"uv2dv",
					["d1", "z1"],
					(x, r) =>
						toSpectral({ u: x.fu, v: x.fv }, {
							z1: [
								[[1, "qe", "u", 0, "D"], [-1, "qm", "v", 1, "S"]],
								[[1, "qe", "u", 1, "D"], [1, "qm", "v", 0, "S"]],
							],
							d1: [
								[[-1, "qe", "v", 0, "D"], [-1, "qm", "u", 1, "S"]],
								[[-1, "qe", "v", 1, "D"], [1, "qm", "u", 0, "S"]],
							],
						}, r),
				],
				[
					"qtend",
					["q1"],
					(x, r) =>
						toSpectral({ u: x.uq, v: x.vq, q: x.qn }, {
							q1: [
								[[1, "qe", "v", 0, "D"], [1, "qc", "q", 0, "S"], [1, "qm", "u", 1, "S"]],
								[[1, "qe", "v", 1, "D"], [1, "qc", "q", 1, "S"], [-1, "qm", "u", 0, "S"]],
							],
						}, r),
				],
				[
					"mktend",
					["d2", "t2", "z2"],
					(x, r) =>
						toSpectral({ fu: x.fu, fv: x.fv, ke: x.ke, tn: x.tn, ut: x.ut, vt: x.vt }, {
							d2: [
								[[1, "qq", "ke", 0, "S"], [-1, "qe", "fv", 0, "D"], [-1, "qm", "fu", 1, "S"]],
								[[1, "qq", "ke", 1, "S"], [-1, "qe", "fv", 1, "D"], [1, "qm", "fu", 0, "S"]],
							],
							t2: [
								[[1, "qe", "vt", 0, "D"], [1, "qc", "tn", 0, "S"], [1, "qm", "ut", 1, "S"]],
								[[1, "qe", "vt", 1, "D"], [1, "qc", "tn", 1, "S"], [-1, "qm", "ut", 0, "S"]],
							],
							z2: [
								[[1, "qe", "fu", 0, "D"], [-1, "qm", "fv", 1, "S"]],
								[[1, "qe", "fu", 1, "D"], [1, "qm", "fv", 0, "S"]],
							],
						}, r),
				],
			]
			const single = Object.fromEntries(Object.entries(gpu).map(([name, values]) => [name, Array.from(values, f)]))
			const kernelChecks = {}
			for (const [name, targets, operator] of operators) {
				const reference = operator(gpu, exact)
				const emulated = operator(single, f)
				for (const target of targets) {
					const scale = rms(reference[target])
					const gpuError = rms(gpu[target], reference[target]) / scale
					const f32Error = rms(emulated[target], reference[target]) / scale
					kernelChecks[`${name} ${target}`] = { gpuRelativeRms: gpuError, sequentialF32RelativeRms: f32Error, ratio: gpuError / f32Error, pass: gpuError <= 2 * f32Error && gpuError <= 1e-5 }
				}
			}
			report[`T${truncation}`] = { tables: checks, kernels: kernelChecks }
		}
		return report
	}, probes)
	const report = { results, errors, chrome: browser.version() }
	await fs.writeFile(path.join(output, "transforms.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
} finally {
	await browser.close()
	await server.close()
}
