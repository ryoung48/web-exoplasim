import type {
	GcmPreparationKind,
	GcmPreparationRequest,
	GcmPreparationResponse,
	GcmPreparationResults,
} from "@/model/climate/gcm/preparation/types"

function run<Kind extends GcmPreparationKind>({
	kind,
	input,
	signal,
}: GcmPreparationRequest<Kind>): Promise<GcmPreparationResults[Kind]> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException("Preparation cancelled", "AbortError"))
			return
		}
		const worker = new Worker(
			new URL("./preparation.worker.ts", import.meta.url),
			{
				type: "module",
			},
		)
		const dispose = () => {
			worker.terminate()
			signal.removeEventListener("abort", abort)
		}
		const abort = () => {
			dispose()
			reject(new DOMException("Preparation cancelled", "AbortError"))
		}
		signal.addEventListener("abort", abort, { once: true })
		worker.onerror = (event) => {
			dispose()
			reject(new Error(event.message || "Map preparation failed"))
		}
		worker.onmessage = ({ data }: MessageEvent<GcmPreparationResponse>) => {
			dispose()
			if (data.type === "failed") reject(new Error(data.message))
			else resolve(data.result as GcmPreparationResults[Kind])
		}
		worker.onmessageerror = () => {
			dispose()
			reject(new Error("Unable to read map preparation result"))
		}
		try {
			worker.postMessage({ kind, input })
		} catch (error) {
			dispose()
			reject(error)
		}
	})
}

export const GCM_PREPARATION = { run }
