import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { chromium } from "playwright"

const output = path.resolve("stats/exoplasim-webgpu/spike")
await fs.mkdir(output, { recursive: true })
const page = `<!doctype html><meta charset=utf-8><title>WebGPU spike</title><pre id=log></pre><script type=module>
const REPEATS = 30
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })
const device = await adapter.requestDevice({ requiredFeatures: ["timestamp-query"], requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension } })
const querySet = device.createQuerySet({ type: "timestamp", count: 2 })
const resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
const storage = (floats) => device.createBuffer({ size: floats * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
const random = (buffer, floats) => device.queue.writeBuffer(buffer, 0, Float32Array.from({ length: floats }, () => Math.random() - 0.5))
const pipeline = (code) => device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } })
const bind = (pipe, buffers) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) })
async function time(record) {
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } })
  record(pass)
  pass.end()
  encoder.resolveQuerySet(querySet, 0, 2, resolve, 0)
  encoder.copyBufferToBuffer(resolve, 0, readback, 0, 16)
  const started = performance.now()
  device.queue.submit([encoder.finish()])
  await device.queue.onSubmittedWorkDone()
  const wallMs = performance.now() - started
  await readback.mapAsync(GPUMapMode.READ)
  const [begin, end] = new BigUint64Array(readback.getMappedRange())
  readback.unmap()
  return { gpuMs: Number(end - begin) / 1e6, wallMs }
}
async function measure(record) {
  await time(record)
  const runs = []
  for (let i = 0; i < REPEATS; i++) runs.push(await time(record))
  return { gpuMs: median(runs.map((r) => r.gpuMs)), wallMs: median(runs.map((r) => r.wallMs)) }
}
const results = { adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, device: adapter.info.device }, userAgent: navigator.userAgent, repeats: REPEATS }

const chain = pipeline(\`@group(0) @binding(0) var<storage, read_write> a: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) { if (g.x < arrayLength(&a)) { a[g.x] = a[g.x] * 0.999 + 1.0; } }\`)
results.dispatch = {}
for (const columns of [64, 2048, 8192]) {
  const buffer = storage(columns)
  const group = bind(chain, [buffer])
  const rows = {}
  for (const count of [1, 60, 200]) {
    rows[count] = await measure((pass) => { pass.setPipeline(chain); pass.setBindGroup(0, group); for (let i = 0; i < count; i++) pass.dispatchWorkgroups(columns / 64) })
  }
  results.dispatch[columns] = { ...rows, gpuUsPerDispatch: (1000 * (rows[200].gpuMs - rows[1].gpuMs)) / 199, wallUsPerDispatch: (1000 * (rows[200].wallMs - rows[1].wallMs)) / 199 }
}

const NTRU = 42, NLAT = 64, NLON = 128, NLEV = 10, FIELDS = 8
const K = 2 * (NTRU + 1), NCSP = ((NTRU + 1) * (NTRU + 2)) / 2, ROWS = NLAT * NLEV * FIELDS, FL = NLEV * FIELDS
const header = \`const NTRU = \${NTRU}u; const NLAT = \${NLAT}u; const NLON = \${NLON}u; const K = \${K}u; const NCSP = \${NCSP}u; const ROWS = \${ROWS}u; const FL = \${FL}u;\`
const grid = storage(ROWS * NLON), fourier = storage(ROWS * K), spectral = storage(FL * NCSP * 2)
const dft = storage(K * NLON), legendre = storage(NCSP * NLAT)
const offsets = device.createBuffer({ size: (NTRU + 2) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
const mOffset = new Uint32Array(NTRU + 2)
for (let m = 1; m <= NTRU + 1; m++) mOffset[m] = mOffset[m - 1] + (NTRU + 2 - m)
device.queue.writeBuffer(offsets, 0, mOffset)
random(grid, ROWS * NLON); random(dft, K * NLON); random(legendre, NCSP * NLAT)
const forwardDft = pipeline(header + \`
@group(0) @binding(0) var<storage, read> g: array<f32>; @group(0) @binding(1) var<storage, read> t: array<f32>; @group(0) @binding(2) var<storage, read_write> f: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= ROWS * K) { return; } let row = i / K; let k = i % K; var s = 0.0;
  for (var j = 0u; j < NLON; j++) { s += t[j * K + k] * g[row * NLON + j]; } f[i] = s; }\`)
const forwardLegendre = pipeline(header + \`
@group(0) @binding(0) var<storage, read> f: array<f32>; @group(0) @binding(1) var<storage, read> p: array<f32>; @group(0) @binding(2) var<storage, read_write> sp: array<f32>; @group(0) @binding(3) var<storage, read> mo: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= FL * NCSP) { return; } let fl = i / NCSP; let s = i % NCSP;
  var m = 0u; loop { if (mo[m + 1u] > s) { break; } m++; }
  var re = 0.0; var im = 0.0;
  for (var lat = 0u; lat < NLAT; lat++) { let w = p[s * NLAT + lat]; let b = (fl * NLAT + lat) * K + 2u * m; re += w * f[b]; im += w * f[b + 1u]; }
  sp[2u * i] = re; sp[2u * i + 1u] = im; }\`)
const inverseLegendre = pipeline(header + \`
@group(0) @binding(0) var<storage, read> sp: array<f32>; @group(0) @binding(1) var<storage, read> p: array<f32>; @group(0) @binding(2) var<storage, read_write> f: array<f32>; @group(0) @binding(3) var<storage, read> mo: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= ROWS * (NTRU + 1u)) { return; } let m = i % (NTRU + 1u); let row = i / (NTRU + 1u); let fl = row / NLAT; let lat = row % NLAT;
  var re = 0.0; var im = 0.0;
  for (var s = mo[m]; s < mo[m + 1u]; s++) { let w = p[s * NLAT + lat]; let b = 2u * (fl * NCSP + s); re += w * sp[b]; im += w * sp[b + 1u]; }
  f[row * K + 2u * m] = re; f[row * K + 2u * m + 1u] = im; }\`)
const inverseDft = pipeline(header + \`
@group(0) @binding(0) var<storage, read> f: array<f32>; @group(0) @binding(1) var<storage, read> t: array<f32>; @group(0) @binding(2) var<storage, read_write> g: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= ROWS * NLON) { return; } let row = i / NLON; let j = i % NLON; var s = 0.0;
  for (var k = 0u; k < K; k++) { s += t[k * NLON + j] * f[row * K + k]; } g[i] = s; }\`)
const steps = [
  [forwardDft, bind(forwardDft, [grid, dft, fourier]), ROWS * K],
  [forwardLegendre, bind(forwardLegendre, [fourier, legendre, spectral, offsets]), FL * NCSP],
  [inverseLegendre, bind(inverseLegendre, [spectral, legendre, fourier, offsets]), ROWS * (NTRU + 1)],
  [inverseDft, bind(inverseDft, [fourier, dft, grid]), ROWS * NLON],
]
const dispatch = (pass, [pipe, group, threads]) => { pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(threads / 64)) }
results.transformT42 = { fieldsTimesLevels: FL, roundTrip: await measure((pass) => steps.forEach((step) => dispatch(pass, step))) }
for (const [name, step] of Object.entries({ forwardDft: steps[0], forwardLegendre: steps[1], inverseLegendre: steps[2], inverseDft: steps[3] })) results.transformT42[name] = await measure((pass) => dispatch(pass, step))
window.spike = results
document.getElementById("log").textContent = JSON.stringify(results, null, 2)
</script>`
const server = http.createServer((request, response) => {
	response.writeHead(200, { "Content-Type": "text/html" })
	response.end(page)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browser = await chromium.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: process.env.SPIKE_HEADED !== "1",
	args: ["--enable-unsafe-webgpu", "--enable-webgpu-developer-features"],
})
try {
	const tab = await browser.newPage()
	const errors = []
	tab.on("pageerror", (error) => errors.push(error.message))
	tab.on("console", (message) => message.type() === "error" && errors.push(message.text()))
	await tab.goto(`http://127.0.0.1:${server.address().port}`)
	await tab.waitForFunction(() => window.spike || document.querySelector("#log").textContent, null, { timeout: 120000 })
	const results = await tab.evaluate(() => window.spike ?? null)
	const report = { results, errors, chromeVersion: browser.version() }
	await fs.writeFile(path.join(output, `spike${process.env.SPIKE_HEADED === "1" ? "-headed" : ""}.json`), JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
} finally {
	await browser.close()
	server.close()
}
