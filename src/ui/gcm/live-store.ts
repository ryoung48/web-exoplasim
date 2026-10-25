import { useSyncExternalStore } from "react"
import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import type { GcmAverager } from "@/model/climate/gcm/averages/types"
import type { GcmAverageState, GcmLiveData, GcmLiveStore } from "@/ui/gcm/types"

const NO_AVERAGES: GcmAverageState = {
	months: [],
	years: [],
	annual: null,
	koppen: null,
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

function averages(averager: GcmAverager): GcmAverageState {
	return {
		months: averager.months,
		years: averager.years,
		annual: GCM_AVERAGES.annual(averager),
		koppen: GCM_AVERAGES.koppen(averager),
	}
}

export const GCM_LIVE = {
	EMPTY,
	create,
	useLive,
	averages,
}
