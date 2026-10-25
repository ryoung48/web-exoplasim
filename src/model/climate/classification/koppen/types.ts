export interface KoppenCellsParams {
	start: number
	end: number
	isLand: Uint8Array
	temperatureMonthly: Float32Array
	rainfallMonthly: Float32Array
	classes: Uint8Array
}
