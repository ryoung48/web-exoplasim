import type { GcmNativePatch } from "@/model/climate/gcm/checkpoint/native/types"

function patch({ buffer, fields }: GcmNativePatch): ArrayBuffer {
	const result = buffer.slice(0)
	const view = new DataView(result)
	const pending = new Set(Object.keys(fields))
	let offset = 0
	const record = () => {
		if (offset + 8 > result.byteLength)
			throw new Error("Truncated native restart record")
		const bytes = view.getUint32(offset, true)
		const start = offset + 4
		if (
			start + bytes + 4 > result.byteLength ||
			view.getUint32(start + bytes, true) !== bytes
		)
			throw new Error("Invalid native restart record")
		offset = start + bytes + 4
		return { start, bytes }
	}
	while (offset < result.byteLength) {
		const nameRecord = record()
		if (nameRecord.bytes !== 16)
			throw new Error("Invalid native restart field name")
		const name = new TextDecoder()
			.decode(new Uint8Array(result, nameRecord.start, 16))
			.trim()
		const data = record()
		const values = fields[name]
		if (!values) continue
		const precision = data.bytes / values.length
		if (precision !== 4 && precision !== 8)
			throw new Error(`Native restart shape mismatch for ${name}`)
		values.forEach((value, i) => {
			if (precision === 8)
				view.setFloat64(data.start + i * precision, value, true)
			else view.setFloat32(data.start + i * precision, value, true)
		})
		pending.delete(name)
	}
	if (pending.size)
		throw new Error(`Native restart fields missing: ${[...pending].join(", ")}`)
	return result
}

export const NATIVE_RESTART = { patch }
