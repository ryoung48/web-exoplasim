export interface GcmDeviceRequest {
	storageBytes: number
	onLost: (message: string) => void
}

export interface GcmDevice {
	device: GPUDevice
	adapter: GPUAdapterInfo
}
