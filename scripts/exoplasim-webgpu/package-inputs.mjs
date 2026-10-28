import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "vite"

const WSL = "//wsl.localhost/Ubuntu/var/tmp/chaos-exoplasim-wasm"
const SOURCES = [
	{ truncation: 21, latitudes: 32, directory: process.argv[2] ?? `${WSL}/inputs` },
	{ truncation: 42, latitudes: 64, directory: process.argv[3] ?? `${WSL}/inputs-t42` },
]
async function writeInputs({ truncation, latitudes, files }) {
	const inputs = `t${truncation}/inputs.json`
	const text = JSON.stringify({ files })
	const namelists = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith("_namelist")))
	await fs.mkdir(path.resolve("public/gcm", `t${truncation}`), { recursive: true })
	await Promise.all([
		fs.writeFile(path.resolve("public/gcm", inputs), text),
		fs.writeFile(path.resolve("public/gcm", `t${truncation}/namelists.json`), JSON.stringify({ files: namelists })),
	])
	return { truncation, latitudes, inputs, downloadBytes: Buffer.byteLength(text) }
}
const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
try {
	const { SURFACE_SETUP } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/setup/surface/index.ts"))
	const { GCM_GRID } = await server.ssrLoadModule(path.resolve("src/model/climate/gcm/grid/index.ts"))
	const resolutions = []
	for (const { truncation, latitudes, directory } of SOURCES) {
		const wanted = new Set(SURFACE_SETUP.CLIMATOLOGY_CODES.map((code) => `N${String(latitudes).padStart(3, "0")}_surf_${String(code).padStart(4, "0")}.sra`))
		const names = (await fs.readdir(directory)).filter((name) => name.endsWith("_namelist") || wanted.has(name)).sort()
		const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await fs.readFile(path.join(directory, name), "utf8")])))
		const entry = await writeInputs({ truncation, latitudes, files })
		resolutions.push(entry)
		console.log(`T${truncation}: ${names.length} files, ${(entry.downloadBytes / 1e6).toFixed(2)} MB`)
	}
	const source = GCM_GRID.forTruncation(42)
	const target = GCM_GRID.forTruncation(63)
	const nearest = Array.from({ length: target.points }, (_, point) => {
		const row = Math.floor(point / target.longitudes)
		let closest = 0
		for (let at = 1; at < source.latitudes; at++)
			if (Math.abs(source.latitudesDeg[at] - target.latitudesDeg[row]) < Math.abs(source.latitudesDeg[closest] - target.latitudesDeg[row])) closest = at
		return closest * source.longitudes + Math.round((point % target.longitudes) * source.longitudes / target.longitudes) % source.longitudes
	})
	const { files: original } = JSON.parse(await fs.readFile("public/gcm/t42/inputs.json", "utf8"))
	const files = Object.fromEntries(Object.entries(original).map(([name, text]) => {
		if (!name.endsWith(".sra")) return [name, text]
		const tokens = text.trim().split(/\s+/)
		const stride = source.points + 8
		if (tokens.length % stride !== 0) throw new Error(`Invalid surface records in ${name}`)
		const lines = []
		for (let start = 0; start < tokens.length; start += stride) {
			const header = tokens.slice(start, start + 8)
			if (Number(header[4]) !== source.longitudes || Number(header[5]) !== source.latitudes) throw new Error(`Unexpected source grid in ${name}`)
			header[4] = String(target.longitudes)
			header[5] = String(target.latitudes)
			lines.push(header.map(value => value.padStart(12)).join(""))
			for (let point = 0; point < target.points; point += 8)
				lines.push(nearest.slice(point, point + 8).map(index => ` ${tokens[start + 8 + index]}`).join(""))
		}
		return [name.replace("N064_", "N096_"), `${lines.join("\n")}\n`]
	}))
	const entry = await writeInputs({ truncation: 63, latitudes: 96, files })
	resolutions.push(entry)
	console.log(`T63: ${Object.keys(files).length} files, ${(entry.downloadBytes / 1e6).toFixed(2)} MB (nearest-neighbour T42 climatologies)`)
	await fs.writeFile(path.resolve("public/gcm/webgpu.json"), `${JSON.stringify({ resolutions }, null, 2)}\n`)
} finally {
	await server.close()
}
