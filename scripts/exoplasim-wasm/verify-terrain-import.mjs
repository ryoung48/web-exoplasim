import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { encode } from "fast-png"
import { chromium } from "playwright"

const baseUrl = process.env.TERRAIN_TEST_URL ?? "http://127.0.0.1:5176"
const output = path.resolve("stats/terrain-import")
const fixture = JSON.parse(await readFile(path.join(output, "fixture.json"), "utf8"))
const name = `chaos-world-${fixture.seed}`
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
try {
	await page.goto(baseUrl)
	const core = await page.evaluate(async ({ name, fixture }) => {
		const { GCM_TERRAIN_IMPORT } = await import("/src/model/climate/gcm/terrain/import/index.ts")
		const { GCM_TERRAIN } = await import("/src/model/climate/gcm/terrain/index.ts")
		const { GCM_BOUNDARY } = await import("/src/model/climate/gcm/boundary/index.ts")
		const { GCM_DOWNSCALE } = await import("/src/model/climate/gcm/downscale/index.ts")
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const { GCM_CHECKPOINT } = await import("/src/model/climate/gcm/checkpoint/index.ts")
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
		const check = (condition, message) => { if (!condition) throw new Error(message) }
		const rejects = (operation) => { try { operation(); return false } catch { return true } }
		const read = async (extension) => GCM_TERRAIN_IMPORT.read({ name: `${name}.${extension}`, buffer: await (await fetch(`/stats/terrain-import/${name}.${extension}`)).arrayBuffer() })
		const heightmap = await read("bin")
		const mask = await read("land-mask.png")
		const mapping = { maxElevationM: 8000, seaLevel: 128, invertMask: false }
		const terrain = GCM_TERRAIN_IMPORT.create({ heightmap, mask, mapping })
		let differences = 0
		for (let i = 0; i < terrain.land.length; i++) {
			check(terrain.land[i] === Number(mask.samples[i] >= 0.5), "Explicit land mask changed")
			differences += Number((terrain.land[i] > 0) !== (terrain.elevationM[i] > 0))
		}
		const sample = { name: "sample", width: 4, height: 2, encoding: "normalized", samples: new Float32Array([0, 0.25, 0.5, 0.75, 1, 0, 0.5, 1]) }
		const sampleMapping = { ...mapping, seaLevel: 127.5 }
		const derived = GCM_TERRAIN_IMPORT.create({ heightmap: sample, mask: null, mapping: sampleMapping })
		check(derived.elevationM.join(",") === "0,0,0,4000,8000,0,0,8000", "Elevation scaling failed")
		check(derived.land.join(",") === "0,0,0,1,1,0,0,1", "Land threshold failed")
		const dim = { ...sample, samples: new Float32Array([0, 0.25, 0.5, 0.75, 0.75, 0, 0.5, 0.75]) }
		const dimTerrain = GCM_TERRAIN_IMPORT.create({ heightmap: dim, mask: null, mapping: sampleMapping })
		check(dimTerrain.elevationM[3] === 8000 && dimTerrain.elevationM[2] === 0, "Brightest sample must reach the maximum elevation")
		const flooded = GCM_TERRAIN_IMPORT.create({ heightmap: dim, mask: null, mapping: { ...mapping, seaLevel: 200 } })
		check(flooded.elevationM.every((value) => value === 0), "Cutoff above the brightest sample must flatten the terrain")
		const white = GCM_TERRAIN_IMPORT.create({ heightmap: sample, mask: null, mapping: { ...mapping, seaLevel: 255 } })
		check(white.land.every((value) => value === 0) && white.elevationM.every((value) => value === 0), "White cutoff failed")
		const inverted = GCM_TERRAIN_IMPORT.create({ heightmap, mask, mapping: { ...mapping, invertMask: true } })
		check(inverted.land.every((value, i) => value === 1 - terrain.land[i]), "Invert mask is incorrect")
		check(rejects(() => GCM_TERRAIN_IMPORT.read({ name: "broken.bin", buffer: new ArrayBuffer(4) })), "Wrong binary length accepted")
		check(rejects(() => GCM_TERRAIN_IMPORT.create({ heightmap, mask: { ...mask, width: 4 }, mapping })), "Mismatched mask accepted")
		check(rejects(() => GCM_TERRAIN_IMPORT.create({ heightmap, mask, mapping: { ...mapping, maxElevationM: -1 } })), "Invalid height mapping accepted")
		const quadrants = { name: "quadrants", width: 4, height: 2, elevationM: new Float32Array([100, 100, 200, 200, 300, 300, 400, 400]), land: new Float32Array(8).fill(1) }
		for (const latitudes of [32, 64]) {
			const grid = GCM_GRID.forLatitudes(latitudes)
			const boundary = GCM_BOUNDARY.fromTerrain({ gravityMs2: 9.80665, grid, terrain })
			check(boundary.landFraction.every((value) => Number.isFinite(value) && value >= -1e-12 && value <= 1 + 1e-12), "Invalid regridded land coverage")
			check(boundary.geopotential.every(Number.isFinite), "Nonfinite geopotential")
			const oriented = GCM_BOUNDARY.fromTerrain({ gravityMs2: 9.80665, grid, terrain: quadrants })
			const west = grid.longitudes * 3 / 4
			const east = grid.longitudes / 4
			for (const [cell, expected] of [[west, 100], [east, 200], [(latitudes - 1) * grid.longitudes + west, 300], [(latitudes - 1) * grid.longitudes + east, 400]]) check(Math.abs(oriented.geopotential[cell] / 9.80665 - expected) < 1e-8, "Terrain orientation changed")
			for (const metres of [0, -100]) {
				const flat = { ...quadrants, elevationM: new Float32Array(8).fill(metres) }
				const result = GCM_BOUNDARY.fromTerrain({ gravityMs2: 9.80665, grid, terrain: flat })
				check(result.landFraction.every((value) => value === 1), "Flat/below-sea land lost")
				check(result.geopotential.every((value) => Math.abs(value / 9.80665 - metres) < 1e-8), "Flat/below-sea terrain changed")
			}
		}
		const downscale = GCM_DOWNSCALE.create({ grid: GCM_GRID.forLatitudes(32), terrain, factor: 2 })
		check(downscale.elevationM.every(Number.isFinite) && downscale.cellElevationM.every(Number.isFinite), "Downscale produced nonfinite terrain")
		const small = GCM_DOWNSCALE.create({ grid: GCM_GRID.forLatitudes(32), terrain: quadrants, factor: 1 })
		check(small.land.every((value) => value === 1), "Downscale lost explicit land")
		const meta = { format: GCM_CHECKPOINT.FORMATS.cpu, config: GCM.DEFAULT_CONFIG, precisionBytes: 8, date: { year: 1, month: 1, day: 1, hour: 0, minute: 0 }, step: 0 }
		const checkpoint = { terrain, meta, restart: new Uint8Array([1, 2, 3]).buffer, diagnostics: { averager: GCM_AVERAGES.create(), snapshot: { step: 0, date: meta.date, values: new Float32Array([1]) } } }
		const restored = GCM_CHECKPOINT.decode(GCM_CHECKPOINT.encode(checkpoint))
		check(restored.terrain.elevationM.every((value, i) => value === terrain.elevationM[i]) && restored.terrain.land.every((value, i) => value === terrain.land[i]), "Checkpoint lost terrain")
		return { ...GCM_TERRAIN.summary(terrain), explicitMaskDifferences: differences, checkpointFormat: GCM_CHECKPOINT.FORMATS.cpu }
	}, { name, fixture })
	console.log("Terrain core checks", core)
	await page.goto(`${baseUrl}/gcm`)
	await page.getByRole("button", { name: "Import terrain" }).click()
	await page.getByLabel("Heightmap").setInputFiles(path.join(output, `${name}.bin`))
	await page.getByRole("button", { name: "Apply terrain", exact: true }).waitFor()
	await page.getByLabel("Land mask").setInputFiles(path.join(output, `${name}.land-mask.png`))
	await page.getByRole("img", { name: /^Land mask/ }).waitFor()
	await page.getByRole("button", { name: "Apply terrain", exact: true }).click()
	assert.equal(await page.getByLabel("Earth surface climatology", { exact: true }).isChecked(), false)
	await page.screenshot({ path: path.join(output, "terrain-import.png"), fullPage: true })
	await page.getByRole("button", { name: "Start", exact: true }).click()
	await page.getByRole("button", { name: "Pause", exact: true }).waitFor({ timeout: 60000 })
	await page.waitForFunction(() => {
		const text = document.body.innerText
		return !text.includes("No data yet") && !text.includes("Loading ExoPlaSim")
	}, null, { timeout: 60000 })
	await page.getByRole("button", { name: "Pause", exact: true }).click()
	const downloadEvent = page.waitForEvent("download", { timeout: 60000 })
	await page.getByRole("button", { name: "Save", exact: true }).click()
	const download = await downloadEvent
	const checkpointFile = path.join(output, "custom-terrain.ckpt")
	await download.saveAs(checkpointFile)
	await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 60000 })
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	await page.getByRole("button", { name: "Use Earth", exact: true }).click()
	await page.locator('input[accept=".ckpt"]').setInputFiles(checkpointFile)
	await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 60000 })
	assert((await page.locator("body").innerText()).includes(`${name}.bin`))
	await page.screenshot({ path: path.join(output, "terrain-checkpoint-restored.png"), fullPage: true })
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	for (const extension of ["16bit.png", "8bit.png"]) {
		await page.getByRole("button", { name: "Import terrain" }).click()
		await page.getByLabel("Heightmap").setInputFiles(path.join(output, `${name}.${extension}`))
		await page.getByRole("slider", { name: "Sea level", exact: true }).press("Home")
		await page.getByRole("spinbutton", { name: "Maximum elevation", exact: true }).fill("20000")
		await page.getByRole("button", { name: "Apply terrain", exact: true }).click()
		await page.getByRole("heading", { name: `ExoPlaSim · ${name}.${extension}`, exact: true }).waitFor()
	}
	await page.getByRole("button", { name: "Import terrain" }).click()
	await page.getByLabel("Invert mask", { exact: true }).check()
	await page.getByLabel("Invert mask", { exact: true }).uncheck()
	const bad = path.join(output, "invalid.png")
	await writeFile(bad, encode({ width: 4, height: 4, channels: 1, depth: 8, data: new Uint8Array(16) }))
	await page.getByLabel("Heightmap").setInputFiles(bad)
	await page.getByRole("alert").waitFor()
	assert.equal(await page.getByRole("button", { name: "Apply terrain", exact: true }).isEnabled(), false)
	const racePage = await browser.newPage()
	racePage.on("pageerror", (error) => errors.push(error.message))
	let releaseEarth
	let earthRequested = false
	const earthGate = new Promise((resolve) => { releaseEarth = resolve })
	await racePage.route("**/earth-data/earth-real-elevation.bin.gz", async (route) => {
		earthRequested = true
		await earthGate
		await route.continue()
	})
	await racePage.goto(`${baseUrl}/gcm`)
	await racePage.getByRole("button", { name: "Import terrain" }).click()
	await racePage.getByLabel("Heightmap").setInputFiles(path.join(output, `${name}.bin`))
	await racePage.getByRole("button", { name: "Apply terrain", exact: true }).click()
	assert(earthRequested, "Earth data request was not intercepted")
	releaseEarth()
	await racePage.waitForLoadState("networkidle")
	await racePage.getByRole("heading", { name: `ExoPlaSim · ${name}.bin`, exact: true }).waitFor()
	await racePage.close()
	assert.deepEqual(errors, [])
	await writeFile(path.join(output, "verification.json"), JSON.stringify({ fixture, core, browserErrors: errors, ui: "binary/8-bit/16-bit import, preview, invert mask, run, pause, save, restore, invalid-file rejection, delayed-Earth selection race passed" }, null, 2))
	console.log("Terrain import UI and checkpoint checks passed")
} catch (error) {
	await page.screenshot({ path: path.join(output, "terrain-test-failure.png"), fullPage: true }).catch(() => {})
	throw error
} finally {
	await browser.close()
}
