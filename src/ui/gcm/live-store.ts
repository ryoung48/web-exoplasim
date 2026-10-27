import { useSyncExternalStore } from "react"
import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import { GCM_CLASSIFICATION } from "@/model/climate/gcm/classification"
import type {
	GcmAverageState,
	GcmAveragesRequest,
	GcmLiveData,
	GcmLiveStore,
} from "@/ui/gcm/types"

const NO_AVERAGES: GcmAverageState = {
	months: [],
	years: [],
	annual: null,
	koppen: null,
	pasta: null,
}
// Background tabs throttle animation frames; this caps how far the view
// can fall behind there.
const BACKGROUND_NOTIFY_MS = 100
const EMPTY: GcmLiveData = {
	snapshot: null,
	averages: NO_AVERAGES,
}

// Live model output stays out of React props: React 19's development
// profiler deep-diffs changed props into performance entries it never evicts.
function create(): GcmLiveStore {
	let data = EMPTY
	let pending = false
	const listeners = new Set<() => void>()
	// Snapshots can arrive faster than the page renders; notifying once per
	// animation frame keeps the view current instead of draining a backlog
	// after the model pauses.
	const notify = () => {
		if (!pending) return
		pending = false
		for (const listener of listeners) listener()
	}
	return {
		get: () => data,
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		update(patch) {
			data = { ...data, ...patch }
			if (pending) return
			pending = true
			requestAnimationFrame(notify)
			setTimeout(notify, BACKGROUND_NOTIFY_MS)
		},
	}
}

function useLive(store: GcmLiveStore): GcmLiveData {
	return useSyncExternalStore(store.subscribe, store.get)
}

function averages({ averager, config }: GcmAveragesRequest): GcmAverageState {
	return {
		months: averager.months,
		years: averager.years,
		annual: GCM_AVERAGES.annual(averager),
		pasta: GCM_CLASSIFICATION.classes({
			config,
			months: averager.months,
			downscale: null,
			scheme: "pasta",
		}),
		koppen: GCM_CLASSIFICATION.classes({
			config,
			months: averager.months,
			downscale: null,
			scheme: "koppen",
		}),
	}
}

export const GCM_LIVE = {
	EMPTY,
	create,
	useLive,
	averages,
}
