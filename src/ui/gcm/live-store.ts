import { useSyncExternalStore } from "react"
import type { GcmAverageState } from "@/model/climate/gcm/averages/types"
import type { GcmLiveData, GcmLiveStore } from "@/ui/gcm/types"

const NO_AVERAGES: GcmAverageState = {
	months: [],
	climateMonths: [],
	climateYears: 0,
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

export const GCM_LIVE = {
	EMPTY,
	create,
	useLive,
}
