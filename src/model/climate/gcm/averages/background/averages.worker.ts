import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import type {
	GcmBackgroundClimate,
	GcmBackgroundMessage,
	GcmBackgroundResponse,
} from "@/model/climate/gcm/averages/background/types"
import type {
	GcmAverager,
	GcmAverageState,
	GcmMonthlyMean,
} from "@/model/climate/gcm/averages/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

let averager: GcmAverager = GCM_AVERAGES.create()
let previous: GcmAverageState | null = null
let currentConfig: GcmConfig | null = null
let configKey = ""

function copy(month: GcmMonthlyMean): GcmMonthlyMean {
	return {
		...month,
		snapshot: { ...month.snapshot, values: month.snapshot.values.slice() },
	}
}

self.onmessage = ({ data }: MessageEvent<GcmBackgroundMessage>) => {
	try {
		if (data.type === "initialize") {
			averager = data.averager
			previous = null
		} else
			GCM_AVERAGES.merge({
				averager,
				months: data.sample.months,
				years: data.sample.years,
			})
		const config = data.type === "initialize" ? data.config : data.sample.config
		const key = JSON.stringify(config)
		if (key !== configKey) {
			configKey = key
			currentConfig = config
		}
		const averages = GCM_AVERAGES.view({
			averager,
			config: currentConfig as GcmConfig,
		})
		const climate: GcmBackgroundClimate | null =
			previous?.climateMonths !== averages.climateMonths ||
			previous?.koppen !== averages.koppen ||
			previous?.pasta !== averages.pasta
				? {
						months: averages.climateMonths.map(copy),
						years: averages.climateYears,
						koppen: averages.koppen?.slice() ?? null,
						pasta: averages.pasta?.slice() ?? null,
					}
				: null
		const months = (
			data.type === "initialize" ? averages.months : data.sample.months
		).map(copy)
		const transfer: ArrayBufferLike[] = months.map(
			(month) => month.snapshot.values.buffer,
		)
		if (averages.annual) transfer.push(averages.annual.values.buffer)
		if (climate) {
			transfer.push(
				...climate.months.map((month) => month.snapshot.values.buffer),
			)
			if (climate.koppen) transfer.push(climate.koppen.buffer)
			if (climate.pasta) transfer.push(climate.pasta.buffer)
		}
		self.postMessage(
			{
				type: "updated",
				months,
				years: averages.years,
				annual: averages.annual,
				climate,
			} satisfies GcmBackgroundResponse,
			{ transfer },
		)
		previous = averages
	} catch (error) {
		self.postMessage({
			type: "failed",
			message: error instanceof Error ? error.message : String(error),
		} satisfies GcmBackgroundResponse)
	}
}
