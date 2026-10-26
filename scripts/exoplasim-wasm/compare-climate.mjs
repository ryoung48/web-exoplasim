import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"

const { values } = parseArgs({ options: { reference: { type: "string" }, candidate: { type: "string" }, discard: { type: "string" }, output: { type: "string" } } })
assert(values.reference && values.candidate && values.discard && values.output, "Usage: --reference <run> --candidate <run> --discard <years> --output <report.json>")
const discard = Number(values.discard)
// Field order written by scripts/exoplasim-wasm/gcm_reference.f90
const FIELDS = ["surfaceTemperatureK", "airTemperatureK", "precipitationMs", "cloudCover", "outgoingLongwaveWm2", "toaNetWm2", "surfacePressurePa", "surfaceNetHeatWm2", "seaIceCover"]
const COMPARED = ["surfaceTemperatureK", "airTemperatureK", "precipitationMs", "cloudCover", "outgoingLongwaveWm2", "toaNetWm2", "surfacePressurePa"]
const ROWS_PER_BAND = 4
// 95% two-sample test for the difference of two N-year means (V2).
const SIGMAS = 2
// With 8 or 16 bands at 95% each, about 0.4-0.8 fail by chance (V2).
const BAND_PASS_FRACTION = 0.9

const server = await createServer({
	configFile: false,
	cacheDir: path.resolve("stats/exoplasim-reference/vite-cache"),
	resolve: { alias: { "@": path.resolve("src") } },
	server: { middlewareMode: true, watch: null },
	appType: "custom",
})
try {
	const { GCM_GRID } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/grid/index.ts"))
	const { GCM_BALANCE } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/balance/index.ts"))
	const read = async (run) => {
		const tokens = (await readFile(path.join(run, "reference-means.txt"), "utf8")).trim().split(/\s+/).map(Number)
		const years = []
		for (let at = 0; at < tokens.length; ) {
			const [, samples, fields, latitudes] = tokens.slice(at, at + 4)
			at += 4
			const zonal = tokens.slice(at, at + fields * latitudes)
			at += fields * latitudes
			years.push({ samples, latitudes, field: (name) => zonal.slice(FIELDS.indexOf(name) * latitudes, (FIELDS.indexOf(name) + 1) * latitudes) })
		}
		return years
	}
	const [reference, candidate] = await Promise.all([read(values.reference), read(values.candidate)])
	const latitudes = reference[0].latitudes
	const weights = GCM_GRID.forLatitudes(latitudes).latitudeWeights
	const weighted = (rows, from, to) => {
		let total = 0
		let weight = 0
		for (let row = from; row < to; row++) {
			total += rows[row] * weights[row]
			weight += weights[row]
		}
		return total / weight
	}
	const globalMean = (year, name) => weighted(year.field(name), 0, latitudes)
	const mean = (series) => series.reduce((sum, value) => sum + value, 0) / series.length
	// Interannual sigma from residuals about a least-squares line, so slab-ocean
	// spin-up still under way in the kept years does not widen the threshold.
	const std = (series) => {
		const center = (series.length - 1) / 2
		const slope = series.reduce((sum, value, i) => sum + (i - center) * (value - mean(series)), 0) / series.reduce((sum, _, i) => sum + (i - center) ** 2, 0)
		return Math.sqrt(series.reduce((sum, value, i) => sum + (value - mean(series) - slope * (i - center)) ** 2, 0) / (series.length - 2))
	}
	const kept = (years) => years.slice(discard)
	const n = Math.min(kept(reference).length, kept(candidate).length)
	assert(n >= 2, `Need at least 2 kept years, have ${n}`)
	const test = (series) => {
		const [ref, cand] = series.map((s) => s.slice(0, n))
		const difference = mean(cand) - mean(ref)
		const threshold = SIGMAS * std(ref) * Math.sqrt(2 / n)
		return { reference: mean(ref), candidate: mean(cand), difference, threshold, sigma: std(ref), pass: Math.abs(difference) <= threshold }
	}
	const global = Object.fromEntries(COMPARED.map((name) => [name, test([kept(reference), kept(candidate)].map((years) => years.map((year) => globalMean(year, name))))]))
	const bands = []
	for (let from = 0; from < latitudes; from += ROWS_PER_BAND) {
		bands.push({ rows: [from, from + ROWS_PER_BAND], ...test([kept(reference), kept(candidate)].map((years) => years.map((year) => weighted(year.field("surfaceTemperatureK"), from, from + ROWS_PER_BAND)))) })
	}
	const balance = (years) => GCM_BALANCE.assess(years.map((year, index) => ({ year: index + 1, toaNetRadiation: globalMean(year, "toaNetWm2"), surfaceNetHeat: globalMean(year, "surfaceNetHeatWm2"), surfaceTemperature: globalMean(year, "surfaceTemperatureK") })))
	const finite = [reference, candidate].every((years) => years.every((year) => FIELDS.every((name) => year.field(name).every(Number.isFinite))))
	const bandPasses = bands.filter((band) => band.pass).length
	const balances = { reference: balance(reference), candidate: balance(candidate) }
	const report = {
		reference: values.reference,
		candidate: values.candidate,
		years: { reference: reference.length, candidate: candidate.length, discarded: discard, compared: n },
		finite,
		global,
		bands,
		bandPassFraction: bandPasses / bands.length,
		balance: balances,
		globalSeries: Object.fromEntries(["reference", "candidate"].map((key) => [key, Object.fromEntries(FIELDS.map((name) => [name, { reference, candidate }[key].map((year) => globalMean(year, name))]))])),
	}
	report.pass = finite && Object.values(global).every((entry) => entry.pass) && report.bandPassFraction >= BAND_PASS_FRACTION && balances.reference.status === balances.candidate.status
	await writeFile(values.output, JSON.stringify(report, null, 2))
	console.log(JSON.stringify({ pass: report.pass, finite, years: report.years, bandPassFraction: report.bandPassFraction, balance: { reference: balances.reference.status, candidate: balances.candidate.status } }))
	for (const [name, entry] of Object.entries(global)) console.log(name.padEnd(22), entry.pass ? "pass" : "FAIL", entry.reference.toPrecision(7), entry.candidate.toPrecision(7), `|Δ|=${Math.abs(entry.difference).toPrecision(3)} ≤ ${entry.threshold.toPrecision(3)}`)
} finally {
	await server.close()
}
