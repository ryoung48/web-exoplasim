import assert from "node:assert/strict"
import fs from "node:fs/promises"

// Reads a gcm_probe.f90 dump: <name>.txt lists "#bytes N", then one
// "variable count" line per variable, in the order of <name>.bin.
export async function readProbe(file) {
	const [header, ...lines] = (await fs.readFile(`${file}.txt`, "utf8")).trim().split("\n").map((line) => line.trim().split(/\s+/))
	assert.equal(header[0], "#bytes")
	const bytes = await fs.readFile(`${file}.bin`)
	const values = Number(header[1]) === 8 ? new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8) : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
	const result = {}
	let at = 0
	for (const [name, count] of lines) {
		result[name] = Array.from(values.subarray(at, at + Number(count)))
		at += Number(count)
	}
	assert.equal(at, values.length)
	return result
}
