import type {
	GcmDimensions,
	GcmFieldRead,
	GcmFieldShape,
	GcmFieldSpec,
	GcmFieldWrite,
	GcmLayout,
	GcmLayoutBuffer,
	GcmLayoutConstants,
	GcmLayoutRequest,
	GcmTableValues,
} from "@/model/climate/gcm/layout/types"

function planeFloats(dimensions: GcmDimensions, shape: GcmFieldShape): number {
	const { truncation, latitudes, longitudes } = dimensions
	if (shape === "spectral") return (truncation + 1) * (truncation + 2)
	if (shape === "fourier") return latitudes * 2 * (truncation + 1)
	if (shape === "grid") return longitudes * latitudes
	return 1
}

function create({ dimensions, fields }: GcmLayoutRequest): GcmLayout {
	const slots: GcmLayout["slots"] = {}
	let floats = 0
	for (const field of fields) {
		if (slots[field.name]) throw new Error(`Duplicate field ${field.name}`)
		const plane = planeFloats(dimensions, field.shape)
		slots[field.name] = {
			offset: floats,
			floats: plane * field.count,
			planeFloats: plane,
		}
		floats += plane * field.count
	}
	return { dimensions, slots, floats }
}

function tableFields(values: GcmTableValues): GcmFieldSpec[] {
	return Object.entries(values).map(([name, table]) => ({
		name,
		shape: "table",
		count: table.length,
	}))
}

function constants({ layout, prefix }: GcmLayoutConstants): string {
	return Object.entries(layout.slots)
		.map(
			([name, slot]) =>
				`const ${prefix}${name.toUpperCase()}: u32 = ${slot.offset}u;`,
		)
		.join("\n")
}

function buffer({ device, layout, label }: GcmLayoutBuffer): GPUBuffer {
	return device.createBuffer({
		label,
		size: Math.max(4, layout.floats * 4),
		usage:
			GPUBufferUsage.STORAGE |
			GPUBufferUsage.COPY_SRC |
			GPUBufferUsage.COPY_DST,
	})
}

function write({ device, buffer, layout, name, values }: GcmFieldWrite): void {
	const slot = layout.slots[name]
	if (values.length !== slot.floats)
		throw new Error(`${name} needs ${slot.floats} values, got ${values.length}`)
	device.queue.writeBuffer(buffer, slot.offset * 4, values)
}

async function read({
	device,
	buffer,
	layout,
	names,
}: GcmFieldRead): Promise<Record<string, Float32Array>> {
	const slots = names.map((name) => layout.slots[name])
	const total = slots.reduce((sum, slot) => sum + slot.floats, 0)
	const staging = device.createBuffer({
		size: total * 4,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	})
	const encoder = device.createCommandEncoder()
	let at = 0
	for (const slot of slots) {
		encoder.copyBufferToBuffer(
			buffer,
			slot.offset * 4,
			staging,
			at * 4,
			slot.floats * 4,
		)
		at += slot.floats
	}
	device.queue.submit([encoder.finish()])
	await staging.mapAsync(GPUMapMode.READ)
	const values = new Float32Array(staging.getMappedRange().slice(0))
	staging.destroy()
	const result: Record<string, Float32Array> = {}
	at = 0
	names.forEach((name, index) => {
		result[name] = values.subarray(at, at + slots[index].floats)
		at += slots[index].floats
	})
	return result
}

export const LAYOUT = {
	create,
	tableFields,
	constants,
	buffer,
	write,
	read,
}
