import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "vite"

// The page's model inputs: ExoPlaSim's namelists and the Earth surface
// climatologies SETUP reads (SURFACE_SETUP.CLIMATOLOGY_CODES), one JSON per
// resolution under public/gcm, plus public/gcm/webgpu.json listing them
// (the Wasm build keeps public/gcm/manifest.json). The sources are the
// input directories scripts/exoplasim-wasm/build.py assembles in WSL.
// Usage: node package-inputs.mjs [inputs-t21] [inputs-t42]
const WSL = "//wsl.localhost/Ubuntu/var/tmp/chaos-exoplasim-wasm"
const SOURCES = [
	{ truncation: 21, latitudes: 32, directory: process.argv[2] ?? `${WSL}/inputs` },
	{ truncation: 42, latitudes: 64, directory: process.argv[3] ?? `${WSL}/inputs-t42` },
]
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
try {
	const { SURFACE_SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/setup/surface/index.ts"))
	const resolutions = []
	for (const { truncation, latitudes, directory } of SOURCES) {
		const wanted = new Set(SURFACE_SETUP.CLIMATOLOGY_CODES.map((code) => `N${String(latitudes).padStart(3, "0")}_surf_${String(code).padStart(4, "0")}.sra`))
		const names = (await fs.readdir(directory)).filter((name) => name.endsWith("_namelist") || wanted.has(name)).sort()
		const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await fs.readFile(path.join(directory, name), "utf8")])))
		const inputs = `t${truncation}/inputs.json`
		const text = JSON.stringify({ files })
		await fs.mkdir(path.resolve("public/gcm", `t${truncation}`), { recursive: true })
		await fs.writeFile(path.resolve("public/gcm", inputs), text)
		resolutions.push({ truncation, latitudes, inputs, downloadBytes: Buffer.byteLength(text) })
		console.log(`T${truncation}: ${names.length} files, ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB`)
	}
	await fs.writeFile(path.resolve("public/gcm/webgpu.json"), `${JSON.stringify({ resolutions }, null, 2)}\n`)
} finally {
	await server.close()
}
