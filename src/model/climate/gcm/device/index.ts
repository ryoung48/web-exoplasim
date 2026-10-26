import type {
	GcmDevice,
	GcmDeviceRequest,
} from "@/model/climate/gcm/device/types"

async function request({
	storageBytes,
	onLost,
}: GcmDeviceRequest): Promise<GcmDevice> {
	if (!navigator.gpu) throw new Error("This page needs WebGPU")
	const adapter = await navigator.gpu.requestAdapter({
		powerPreference: "high-performance",
	})
	if (!adapter) throw new Error("No WebGPU adapter is available")
	if (storageBytes > adapter.limits.maxStorageBufferBindingSize) {
		throw new Error(
			`Model state needs ${storageBytes} bytes in one buffer; this GPU allows ${adapter.limits.maxStorageBufferBindingSize}`,
		)
	}
	const device = await adapter.requestDevice({
		requiredLimits: {
			maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
			maxBufferSize: adapter.limits.maxBufferSize,
		},
	})
	void device.lost.then((info) => onLost(info.message || info.reason))
	device.addEventListener("uncapturederror", (event) =>
		onLost((event as GPUUncapturedErrorEvent).error.message),
	)
	return { device, adapter: adapter.info }
}

export const GCM_DEVICE = {
	request,
}
