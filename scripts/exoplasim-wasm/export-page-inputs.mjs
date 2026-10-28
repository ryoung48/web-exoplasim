import assert from "node:assert/strict"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import { createServer } from "vite"

const [baseT21, baseT42] = process.argv.slice(2)
assert(baseT21 && baseT42, "Usage: node scripts/exoplasim-wasm/export-page-inputs.mjs <inputs-t21> <inputs-t42>")
const output = path.resolve("stats/exoplasim-reference/inputs")
const server = await createServer({
	configFile: false,
	cacheDir: path.resolve("stats/exoplasim-reference/vite-cache"),
	resolve: { alias: { "@": path.resolve("src") } },
	server: { middlewareMode: true, watch: null },
	appType: "custom",
})
try {
	const load = (file) => server.ssrLoadModule(path.resolve("src/model/climate/gcm", file))
	const { GCM } = await load("index.ts")
	const { GCM_TERRAIN } = await load("terrain/index.ts")
	const { GCM_BOUNDARY } = await load("boundary/index.ts")
	const { GCM_GRID } = await load("grid/index.ts")
	const { GCM_NAMELIST } = await load("namelist/index.ts")
	const meta = JSON.parse(await readFile("public/earth-data/earth-real-elevation.json", "utf8"))
	const bytes = gunzipSync(await readFile(path.join("public/earth-data", meta.bin)))
	const raster = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
	const terrain = GCM_TERRAIN.fromEarth({ elevation: { raster, width: meta.width, height: meta.height, nodata: meta.nodata }, scale: meta.scale })
	const defaults = GCM.DEFAULT_CONFIG
	// Panel settings combined so every non-default switch value runs at least
	// once; coverage takes the union over these runs.
	const configs = {
		earth: {},
		bare: { earthSurfaceClimatology: false },
		alt1: { vegetation: 0, glaciers: { ...defaults.glaciers, enabled: false }, ozone: false, physicsFilter: ["none"], timestepMinutes: 30 },
		alt2: { starTemperatureK: 0, wetSoil: true, physicsFilter: ["gp", "lh", "sp"], vegetation: 1 },
		orbit: { eccentricity: 0.3, obliquityDeg: 60, fixedOrbit: false, physicsFilter: ["gp", "cesaro", "sp"], rotationPeriodDays: 2 },
	}
	for (const [truncation, latitudes, base] of [[21, 32, baseT21], [42, 64, baseT42]]) {
		const boundary = GCM_BOUNDARY.files(GCM_BOUNDARY.fromTerrain({ gravityMs2: 9.80665, grid: GCM_GRID.forLatitudes(latitudes), terrain }))
		for (const [name, overrides] of Object.entries(configs)) {
			const config = { ...defaults, ...overrides, truncation }
			const directory = path.join(output, `${name}-t${truncation}`)
			await rm(directory, { recursive: true, force: true })
			await mkdir(directory, { recursive: true })
			const files = {}
			for (const file of await readdir(base)) {
				if (file.endsWith("namelist") || (config.earthSurfaceClimatology && file.endsWith(".sra"))) files[file] = await readFile(path.join(base, file), "utf8")
			}
			Object.assign(files, boundary)
			const edits = GCM_NAMELIST.edits(config)
			if (name === "alt2") edits.radmod_namelist.NRADINT = "3"
			for (const [file, values] of Object.entries(edits)) {
				assert(files[file], `Missing ${file} in ${base}`)
				files[file] = GCM_NAMELIST.apply({ text: files[file], values })
			}
			for (const [file, text] of Object.entries(files)) await writeFile(path.join(directory, file), text)
			await writeFile(path.join(directory, "config.json"), JSON.stringify(config, null, 2))
			console.log(directory, Object.keys(files).length, "files")
		}
	}
} finally {
	await server.close()
}
