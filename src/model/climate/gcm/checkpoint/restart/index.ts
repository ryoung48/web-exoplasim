import type {
	GcmRestartDecode,
	GcmRestartEncode,
	GcmRestartHeader,
	GcmRestartState,
} from "@/model/climate/gcm/checkpoint/restart/types"

// File layout: magic, uint32 header length, JSON header (field names and
// float counts in the layout's order, step, carbon counter), padding to 4
// bytes, then each field's f32 values in that order.
const MAGIC = "GCM-WEBGPU-STATE\n"
const LENGTH_BYTES = 4

function fieldOrder(
	layout: GcmRestartDecode["layout"],
): Array<[string, number]> {
	return Object.entries(layout.slots)
		.sort(([, a], [, b]) => a.offset - b.offset)
		.map(([name, slot]) => [name, slot.floats])
}

function encode({
	layout,
	values,
	step,
	carbonStep,
}: GcmRestartEncode): ArrayBuffer {
	const fields = fieldOrder(layout)
	const header: GcmRestartHeader = { fields, step, carbonStep }
	const magic = new TextEncoder().encode(MAGIC)
	const json = new TextEncoder().encode(JSON.stringify(header))
	const start = Math.ceil((magic.length + LENGTH_BYTES + json.length) / 4) * 4
	const floats = fields.reduce((sum, [, count]) => sum + count, 0)
	const bytes = new Uint8Array(start + floats * 4)
	bytes.set(magic, 0)
	new DataView(bytes.buffer).setUint32(magic.length, json.length, true)
	bytes.set(json, magic.length + LENGTH_BYTES)
	const data = new Float32Array(bytes.buffer, start)
	let at = 0
	for (const [name, count] of fields) {
		data.set(values[name], at)
		at += count
	}
	return bytes.buffer
}

function decode({ buffer, layout }: GcmRestartDecode): GcmRestartState {
	const magic = new TextEncoder().encode(MAGIC)
	const bytes = new Uint8Array(buffer)
	if (new TextDecoder().decode(bytes.subarray(0, magic.length)) !== MAGIC)
		throw new Error("This checkpoint was not saved by the WebGPU model")
	const length = new DataView(buffer).getUint32(magic.length, true)
	const jsonStart = magic.length + LENGTH_BYTES
	const header = JSON.parse(
		new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + length)),
	) as GcmRestartHeader
	const expected = fieldOrder(layout)
	const matches =
		header.fields.length === expected.length &&
		header.fields.every(
			([name, count], i) => name === expected[i][0] && count === expected[i][1],
		)
	if (!matches)
		throw new Error(
			"This checkpoint's model state does not match this version of the model",
		)
	const start = Math.ceil((jsonStart + length) / 4) * 4
	const values: Record<string, Float32Array> = {}
	let at = start
	for (const [name, count] of header.fields) {
		values[name] = new Float32Array(buffer.slice(at, at + count * 4))
		at += count * 4
	}
	return { values, step: header.step, carbonStep: header.carbonStep }
}

export const RESTART = {
	encode,
	decode,
}
