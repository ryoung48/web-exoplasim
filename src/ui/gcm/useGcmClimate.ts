import { useEffect, useState } from "react"
import type { GcmClassificationRequest } from "@/model/climate/gcm/classification/types"
import { GCM_PREPARATION } from "@/model/climate/gcm/preparation"
import type { GcmClimateMapResult, GcmClimateMapState } from "@/ui/gcm/types"

export function useGcmClimate({
	config,
	months,
	downscale,
	scheme,
}: GcmClassificationRequest): GcmClimateMapState {
	const [result, setResult] = useState<GcmClimateMapResult | null>(null)
	useEffect(() => {
		if (!downscale || months.length < 12) return
		const controller = new AbortController()
		const request = { config, months, downscale, scheme }
		void GCM_PREPARATION.run({
			kind: "classification",
			input: request,
			signal: controller.signal,
		}).then(
			(classes) => {
				if (!controller.signal.aborted)
					setResult({ request, classes, error: null })
			},
			(error: unknown) => {
				if (!controller.signal.aborted)
					setResult({
						request,
						classes: null,
						error: error instanceof Error ? error.message : String(error),
					})
			},
		)
		return () => controller.abort()
	}, [config, months, downscale, scheme])
	const enabled = Boolean(downscale) && months.length >= 12
	const matches =
		result?.request.downscale === downscale && result.request.scheme === scheme
	const current =
		matches &&
		result.request.months === months &&
		result.request.config === config
	return {
		classes: enabled && matches ? result.classes : null,
		pending: enabled && !current,
		error: current ? result.error : null,
	}
}
