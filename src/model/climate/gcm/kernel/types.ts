import type { GcmLayout } from "@/model/climate/gcm/layout/types"

export interface GcmKernelContextRequest {
	device: GPUDevice
	state: GcmLayout
	tables: GcmLayout
}

export interface GcmKernelContext {
	device: GPUDevice
	state: GcmLayout
	tables: GcmLayout
	stateBuffer: GPUBuffer
	tableBuffer: GPUBuffer
	pipelineLayout: GPUPipelineLayout
	bindGroup: GPUBindGroup
	header: string
}

export interface GcmKernelPipelineRequest {
	context: GcmKernelContext
	label: string
	code: string
	constants: Record<string, number>
}

export interface GcmKernel {
	pipeline: GPUComputePipeline
	threads: number
}

export interface GcmKernelDispatch {
	pass: GPUComputePassEncoder
	context: GcmKernelContext
	kernel: GcmKernel
}

export interface GcmTransferRequest {
	context: GcmKernelContext
	source: string
	target: string
	planes: number
}
