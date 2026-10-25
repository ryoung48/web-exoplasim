import { decode, hasPngSignature } from "fast-png"
import { GCM_TERRAIN } from "@/model/climate/gcm/terrain"
import type {
	GcmTerrainFile,
	GcmTerrainImage,
	GcmTerrainImport,
} from "@/model/climate/gcm/terrain/import/types"
import type { GcmTerrain } from "@/model/climate/gcm/terrain/types"

const CHAOS_WIDTH = 1440
const CHAOS_HEIGHT = 720
const MAX_FILE_BYTES = 64 * 1024 * 1024

function read({ name, buffer }: GcmTerrainFile): GcmTerrainImage {
	if (buffer.byteLength > MAX_FILE_BYTES)
		throw new Error("Terrain files must be smaller than 64 MiB")
	if (name.toLowerCase().endsWith(".bin")) {
		if (buffer.byteLength !== CHAOS_WIDTH * CHAOS_HEIGHT * 2)
			throw new Error(
				"Chaos Machine terrain must contain 1440 × 720 signed 16-bit elevations",
			)
		const view = new DataView(buffer)
		const samples = Float32Array.from(
			{ length: CHAOS_WIDTH * CHAOS_HEIGHT },
			(_, i) => view.getInt16(i * 2, true),
		)
		return {
			name,
			width: CHAOS_WIDTH,
			height: CHAOS_HEIGHT,
			samples,
			encoding: "metres",
		}
	}
	const bytes = new Uint8Array(buffer)
	if (!hasPngSignature(bytes) || bytes.length < 33)
		throw new Error(
			"Choose a grayscale PNG or a Chaos Machine terrain .bin file",
		)
	const header = new DataView(buffer)
	const width = header.getUint32(16)
	const height = header.getUint32(20)
	GCM_TERRAIN.validateDimensions({ width, height })
	const png = decode(bytes, { checkCrc: true })
	const samples = new Float32Array(width * height)
	const max = 2 ** png.depth - 1
	for (let i = 0; i < samples.length; i++) {
		const offset = i * png.channels
		const color = png.palette ? png.palette[png.data[offset]] : null
		const r = color ? color[0] : png.data[offset]
		const g = color ? color[1] : png.channels >= 3 ? png.data[offset + 1] : r
		const b = color ? color[2] : png.channels >= 3 ? png.data[offset + 2] : r
		const alpha = color
			? (color[3] ?? 255)
			: png.channels % 2 === 0
				? png.data[offset + png.channels - 1]
				: max
		if (r !== g || r !== b)
			throw new Error(
				"Use a grayscale image; colored map screenshots do not encode elevations",
			)
		if (alpha !== (color ? 255 : max) || png.transparency?.[0] === r)
			throw new Error(
				"Transparent or missing pixels are unsupported; fill every pixel before importing",
			)
		samples[i] = r / (color ? 255 : max)
	}
	return { name, width, height, samples, encoding: "normalized" }
}

function create({ heightmap, mask, mapping }: GcmTerrainImport): GcmTerrain {
	const { blackM, whiteM, seaLevelM, invertMask } = mapping
	if (![blackM, whiteM, seaLevelM].every(Number.isFinite) || whiteM <= blackM)
		throw new Error("Enter finite elevations with white higher than black")
	if (
		mask &&
		(mask.encoding !== "normalized" ||
			mask.width !== heightmap.width ||
			mask.height !== heightmap.height)
	)
		throw new Error(
			"Land mask must be a PNG with the same dimensions as the heightmap",
		)
	const elevationM = new Float32Array(heightmap.samples.length)
	const land = new Float32Array(elevationM.length)
	for (let i = 0; i < land.length; i++) {
		const value =
			heightmap.encoding === "metres"
				? heightmap.samples[i]
				: blackM + heightmap.samples[i] * (whiteM - blackM)
		elevationM[i] = value - seaLevelM
		land[i] = mask
			? Number(invertMask ? mask.samples[i] < 0.5 : mask.samples[i] >= 0.5)
			: Number(elevationM[i] > 0)
	}
	return GCM_TERRAIN.validate({
		name: heightmap.name,
		width: heightmap.width,
		height: heightmap.height,
		elevationM,
		land,
	})
}

export const GCM_TERRAIN_IMPORT = { read, create, MAX_FILE_BYTES }
