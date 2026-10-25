import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { deserialize } from "node:v8"
import { encode } from "fast-png"
import { createServer } from "vite"

const [chaosRoot, worldFile] = process.argv.slice(2)
assert(chaosRoot && worldFile, "Usage: node scripts/exoplasim-wasm/export-chaos-fixture.mjs <chaos-machine-root> <saved-world.bin>")
const output = path.resolve("stats/terrain-import")
await mkdir(output, { recursive: true })
const server = await createServer({
	root: path.resolve(chaosRoot),
	configFile: false,
	cacheDir: path.join(output, "vite-cache"),
	resolve: { alias: { "@": path.resolve(chaosRoot, "src") } },
	server: { middlewareMode: true, watch: null },
	appType: "custom",
})
try {
	console.log("Reading saved Chaos Machine world")
	const bytes = await readFile(worldFile)
	const world = deserialize(bytes)
	console.log("Loaded world", world.params.seed, world.mesh.numRegions)
	const { WEBGCM_EXPORT } = await server.ssrLoadModule("/src/model/climate/export/webgcm/index.ts")
	console.log("Sampling terrain and mask")
	const raster = await WEBGCM_EXPORT.createRaster({ mesh: world.mesh, elevationKm: world.elevation_km, isLand: world.isLand, onProgress: (progress) => { if (progress.percent % 20 === 0) console.log(progress) } })
	const name = `chaos-world-${world.params.seed}`
	await writeFile(path.join(output, `${name}.bin`), new Uint8Array(raster.elevation))
	await writeFile(path.join(output, `${name}.land-mask.png`), encode({ width: raster.width, height: raster.height, channels: 1, depth: 8, data: raster.land }))
	const view = new DataView(raster.elevation)
	const samples = Uint16Array.from({ length: raster.width * raster.height }, (_, i) => Math.round((view.getInt16(i * 2, true) + 12000) / 32000 * 65535))
	await writeFile(path.join(output, `${name}.16bit.png`), encode({ width: raster.width, height: raster.height, channels: 1, depth: 16, data: samples }))
	await writeFile(path.join(output, `${name}.8bit.png`), encode({ width: raster.width, height: raster.height, channels: 1, depth: 8, data: Uint8Array.from(samples, (value) => Math.round(value / 257)) }))
	let minM = Infinity
	let maxM = -Infinity
	let landPixels = 0
	let maskSignDifferences = 0
	for (let i = 0; i < samples.length; i++) {
		const value = view.getInt16(i * 2, true)
		assert(value >= -12000 && value <= 20000)
		minM = Math.min(minM, value)
		maxM = Math.max(maxM, value)
		landPixels += Number(raster.land[i] > 0)
		maskSignDifferences += Number((raster.land[i] > 0) !== (value > 0))
	}
	const report = { seed: world.params.seed, source: path.resolve(worldFile), sourceSha256: createHash("sha256").update(bytes).digest("hex"), width: raster.width, height: raster.height, minM, maxM, landPixels, maskSignDifferences }
	await writeFile(path.join(output, "fixture.json"), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
} finally {
	await server.close()
}
