import type {
	GcmKernel,
	GcmKernelContext,
	GcmKernelContextRequest,
	GcmKernelDispatch,
	GcmKernelPipelineRequest,
} from "@/model/climate/gcm/kernel/types"
import { LAYOUT } from "@/model/climate/gcm/layout"

// A multiple of NVIDIA's 32-wide warps and AMD's 64-wide wavefronts, within
// WebGPU's default maxComputeInvocationsPerWorkgroup of 256.
const WORKGROUP_SIZE = 64
const BINDINGS = `@group(0) @binding(0) var<storage, read_write> state: array<f32>;
@group(0) @binding(1) var<storage, read> tables: array<f32>;
override THREADS: u32;`

function context({
	device,
	state,
	tables,
}: GcmKernelContextRequest): GcmKernelContext {
	const stateBuffer = LAYOUT.buffer({
		device,
		layout: state,
		label: "gcm state",
	})
	const tableBuffer = LAYOUT.buffer({
		device,
		layout: tables,
		label: "gcm tables",
	})
	const bindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: "storage" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: "read-only-storage" },
			},
		],
	})
	const { truncation, latitudes, longitudes, levels } = state.dimensions
	const dimensions = [
		["NTRU", truncation],
		["NTP1", truncation + 1],
		["NLAT", latitudes],
		["NLON", longitudes],
		["NLEV", levels],
		["NLEM", levels - 1],
		["NLEP", levels + 1],
		["NHOR", latitudes * longitudes],
		["NCSP", ((truncation + 1) * (truncation + 2)) / 2],
		["NRSP", (truncation + 1) * (truncation + 2)],
		["NFC", 2 * (truncation + 1)],
	]
		.map(([name, value]) => `const ${name}: u32 = ${value}u;`)
		.join("\n")
	return {
		device,
		state,
		tables,
		stateBuffer,
		tableBuffer,
		pipelineLayout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		bindGroup: device.createBindGroup({
			layout: bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: stateBuffer } },
				{ binding: 1, resource: { buffer: tableBuffer } },
			],
		}),
		header: [
			dimensions,
			LAYOUT.constants({ layout: state, prefix: "" }),
			LAYOUT.constants({ layout: tables, prefix: "TABLE_" }),
			BINDINGS,
		].join("\n"),
	}
}

async function pipeline({
	context,
	label,
	code,
	constants,
}: GcmKernelPipelineRequest): Promise<GcmKernel> {
	const threads = constants.THREADS
	const module = context.device.createShaderModule({
		label,
		code: `${context.header}\n${code.replaceAll("WORKGROUP_SIZE", String(WORKGROUP_SIZE))}`,
	})
	return {
		pipeline: await context.device.createComputePipelineAsync({
			label,
			layout: context.pipelineLayout,
			compute: { module, entryPoint: "main", constants },
		}),
		threads,
	}
}

function dispatch({ pass, context, kernel }: GcmKernelDispatch): void {
	pass.setPipeline(kernel.pipeline)
	pass.setBindGroup(0, context.bindGroup)
	pass.dispatchWorkgroups(Math.ceil(kernel.threads / WORKGROUP_SIZE))
}

export const KERNEL = {
	context,
	pipeline,
	dispatch,
}
