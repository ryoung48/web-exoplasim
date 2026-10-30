import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import type {
	GcmBackgroundAnalysis,
	GcmBackgroundRequest,
	GcmBackgroundResponse,
} from "@/model/climate/gcm/averages/background/types"
import type { GcmAverageState } from "@/model/climate/gcm/averages/types"

function create(request: GcmBackgroundRequest): GcmBackgroundAnalysis {
	const worker = new Worker(new URL("./averages.worker.ts", import.meta.url), {
		type: "module",
	})
	let current: GcmAverageState | null = null
	worker.onmessage = ({ data }: MessageEvent<GcmBackgroundResponse>) => {
		if (data.type === "failed") {
			request.onError(data.message)
			return
		}
		const climateMonths = data.climate?.months ?? current?.climateMonths ?? []
		current = {
			months: GCM_AVERAGES.mergeMonths({
				months: current?.months ?? [],
				incoming: data.months,
				limit: GCM_AVERAGES.MONTHS_PER_YEAR,
			}),
			years: data.years,
			annual: data.annual,
			climateMonths,
			climateYears: data.climate?.years ?? current?.climateYears ?? 0,
			koppen: data.climate ? data.climate.koppen : (current?.koppen ?? null),
			pasta: data.climate ? data.climate.pasta : (current?.pasta ?? null),
		}
		request.onUpdate(current)
	}
	worker.onerror = (event) =>
		request.onError(event.message || "Climate analysis worker failed")
	worker.onmessageerror = () =>
		request.onError("Unable to read climate analysis")
	worker.postMessage({
		type: "initialize",
		averager: request.averager,
		config: request.config,
	})
	return {
		update: (sample) => worker.postMessage({ type: "update", sample }),
		stop: () => worker.terminate(),
	}
}

export const GCM_BACKGROUND_AVERAGES = { create }
