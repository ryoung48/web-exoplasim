export interface GcmDeviceRequest {
	storageBytes: number
	onLost: (message: string) => void
}

export interface GcmDevice {
	device: GPUDevice
	adapter: GPUAdapterInfo
	// Whether the device has the timestamp-query feature.
	timestamps: boolean
}
