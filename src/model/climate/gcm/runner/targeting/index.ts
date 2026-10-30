import type { GcmTargetResume } from "@/model/climate/gcm/runner/targeting/types"
import type { GcmRun, GcmRunRequest } from "@/model/climate/gcm/runner/types"
import { GCM_WASM_RUNNER } from "@/model/climate/gcm/runner/wasm"
import { GCM_WEBGPU_RUNNER } from "@/model/climate/gcm/runner/webgpu"
import { GCM_TARGETING } from "@/model/climate/gcm/targeting"

function start(request: GcmRunRequest): GcmRun {
	let state = request.targeting ?? GCM_TARGETING.create(request.config)
	GCM_TARGETING.validate({ config: request.config, state })
	let config = GCM_TARGETING.forcing({
		config: request.config,
		co2Ppm: state.co2Ppm,
	})
	let current: GcmRun | null = null
	let paused = request.startPaused
	let stopped = false
	let savePending = false
	let changing = false
	let sessionId = 0
	let previousConfig = request.previousConfig
	const notify = () => request.onTargeting({ config, state })
	const launch = (saved: GcmTargetResume) => {
		const id = ++sessionId
		const engineRequest: GcmRunRequest = {
			...request,
			previousConfig,
			config,
			restart: saved.restart,
			averager: saved.averager,
			startPaused: paused,
			onStatus: (update) => {
				if (!stopped && id === sessionId) request.onStatus(update)
			},
			onSnapshot: (snapshot) => {
				if (stopped || id !== sessionId) return
				if (state.trialStartYear === null) {
					state = { ...state, trialStartYear: snapshot.date.year }
					notify()
				}
				request.onSnapshot(snapshot)
			},
			onAverages: (update) => {
				if (stopped || id !== sessionId) return
				request.onAverages(update)
				const next = GCM_TARGETING.assess({
					state,
					targetK: config.targetTemperatureK as number,
					years: update.years,
				})
				if (next === state) return
				state = next
				notify()
				if (state.status === "adjusting" && !changing) {
					changing = true
					current?.checkpoint()
				} else if (state.status === "converged" || state.status === "limited") {
					paused = true
					current?.pause()
				}
			},
			onCheckpoint: (checkpoint) => {
				if (stopped || id !== sessionId) return
				const replace = changing
				if (replace) {
					current?.stop()
					const co2Ppm = state.history[state.history.length - 1].toCo2Ppm
					config = GCM_TARGETING.forcing({ config, co2Ppm })
					state = {
						...state,
						status: "settling",
						co2Ppm,
						trialStartYear: null,
						yearsAtForcing: 0,
						meanTemperatureK: null,
						message: "Settling climate after CO₂ adjustment",
					}
					changing = false
					notify()
				}
				if (savePending) {
					savePending = false
					request.onCheckpoint({ ...checkpoint, targeting: state })
				}
				if (replace && !stopped) launch(checkpoint)
			},
		}
		previousConfig = null
		current =
			request.engine === "cpu"
				? GCM_WASM_RUNNER.start(engineRequest)
				: GCM_WEBGPU_RUNNER.start(engineRequest)
	}
	notify()
	launch({ restart: request.restart, averager: request.averager })
	return {
		pause() {
			paused = true
			current?.pause()
		},
		resume() {
			paused = false
			current?.resume()
		},
		checkpoint() {
			savePending = true
			if (!changing) current?.checkpoint()
		},
		stop() {
			stopped = true
			current?.stop()
		},
	}
}

export const GCM_TARGETING_RUNNER = { start }
