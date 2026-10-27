import type {
	GcmCheckpoint,
	GcmCheckpointArray,
	GcmCheckpointMeta,
} from "@/model/climate/gcm/checkpoint/types"
import type { GcmEngine } from "@/model/climate/gcm/runner/types"

// File layout: magic, uint32 header length, JSON header, uint32 array bytes,
// diagnostic arrays, then the engine's restart data. The format names the
// engine: 2 is the Wasm model's plasim_status, 3 the WebGPU model's state
// (RESTART), so a checkpoint loads into the engine that saved it.
const MAGIC = "EXOPLASIM-CHECKPOINT\n"
const FORMATS: Record<GcmEngine, number> = { cpu: 2, gpu: 3 }
// The WebGPU state is f32; the Wasm build's reals are its manifest's.
const GPU_PRECISION_BYTES = 4
const HEADER_LENGTH_BYTES = 4

function encode({ meta, restart, diagnostics }: GcmCheckpoint): ArrayBuffer {
	const magic = new TextEncoder().encode(MAGIC)
	const arrays: Uint8Array[] = []
	let arrayBytes = 0
	const header = new TextEncoder().encode(
		JSON.stringify({ meta, diagnostics }, (...[, value]) => {
			if (value instanceof Float32Array || value instanceof Float64Array) {
				const descriptor: GcmCheckpointArray = {
					array:
						value instanceof Float32Array ? "Float32Array" : "Float64Array",
					offset: arrayBytes,
					bytes: value.byteLength,
				}
				arrays.push(
					new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
				)
				arrayBytes += value.byteLength
				return descriptor
			}
			return value
		}),
	)
	const bytes = new Uint8Array(
		magic.length +
			2 * HEADER_LENGTH_BYTES +
			header.length +
			arrayBytes +
			restart.byteLength,
	)
	bytes.set(magic, 0)
	new DataView(bytes.buffer).setUint32(magic.length, header.length, true)
	bytes.set(header, magic.length + HEADER_LENGTH_BYTES)
	let offset = magic.length + HEADER_LENGTH_BYTES + header.length
	new DataView(bytes.buffer).setUint32(offset, arrayBytes, true)
	offset += HEADER_LENGTH_BYTES
	for (const array of arrays) {
		bytes.set(array, offset)
		offset += array.byteLength
	}
	bytes.set(new Uint8Array(restart), offset)
	return bytes.buffer
}

function decode(buffer: ArrayBuffer): GcmCheckpoint {
	const magic = new TextEncoder().encode(MAGIC)
	const bytes = new Uint8Array(buffer)
	if (new TextDecoder().decode(bytes.subarray(0, magic.length)) !== MAGIC) {
		throw new Error("Not an ExoPlaSim checkpoint file")
	}
	if (buffer.byteLength < magic.length + HEADER_LENGTH_BYTES) {
		throw new Error("Truncated ExoPlaSim checkpoint")
	}
	const headerLength = new DataView(buffer).getUint32(magic.length, true)
	const headerStart = magic.length + HEADER_LENGTH_BYTES
	const headerEnd = headerStart + headerLength
	if (headerEnd + HEADER_LENGTH_BYTES > buffer.byteLength) {
		throw new Error("Truncated ExoPlaSim checkpoint")
	}
	const header = new TextDecoder().decode(
		bytes.subarray(headerStart, headerEnd),
	)
	const parsed = JSON.parse(header)
	const meta = (parsed.meta ?? parsed) as GcmCheckpointMeta
	if (!Object.values(FORMATS).includes(meta.format)) {
		throw new Error(
			`Unsupported checkpoint format ${meta.format}. Format ${FORMATS.cpu} (CPU) or ${FORMATS.gpu} (GPU) with saved climate averages is required.`,
		)
	}
	const arrayBytes = new DataView(buffer).getUint32(headerEnd, true)
	const arrayStart = headerEnd + HEADER_LENGTH_BYTES
	const restartStart = arrayStart + arrayBytes
	if (restartStart >= buffer.byteLength)
		throw new Error("Truncated ExoPlaSim checkpoint")
	const { diagnostics } = JSON.parse(header, (...[, value]) => {
		if (value?.array === "Float32Array" || value?.array === "Float64Array") {
			const descriptor = value as GcmCheckpointArray
			if (
				!Number.isInteger(descriptor.offset) ||
				!Number.isInteger(descriptor.bytes) ||
				descriptor.offset < 0 ||
				descriptor.bytes < 0 ||
				descriptor.offset + descriptor.bytes > arrayBytes
			) {
				throw new Error("Invalid checkpoint diagnostic array")
			}
			const data = buffer.slice(
				arrayStart + descriptor.offset,
				arrayStart + descriptor.offset + descriptor.bytes,
			)
			return descriptor.array === "Float32Array"
				? new Float32Array(data)
				: new Float64Array(data)
		}
		return value
	}) as GcmCheckpoint
	return { meta, diagnostics, restart: buffer.slice(restartStart) }
}

function engine(meta: GcmCheckpointMeta): GcmEngine {
	return meta.format === FORMATS.gpu ? "gpu" : "cpu"
}

function fileName(meta: GcmCheckpointMeta): string {
	const { year, month } = meta.date
	return `exoplasim-t${meta.config.truncation}-year${String(year).padStart(4, "0")}-month${String(month).padStart(2, "0")}.ckpt`
}

export const GCM_CHECKPOINT = {
	FORMATS,
	GPU_PRECISION_BYTES,
	engine,
	encode,
	decode,
	fileName,
}
