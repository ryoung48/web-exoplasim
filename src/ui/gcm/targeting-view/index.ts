import type { GcmTargetViewRequest } from "@/ui/gcm/targeting-view/types"
import type { GcmBalanceRow } from "@/ui/gcm/types"
import {
	formatTemperature,
	formatWithUnit,
} from "@/ui/genesis/shared/ui-format"

function signedPpm(value: number): string {
	return `${value >= 0 ? "+" : ""}${formatWithUnit(value, "ppm", 3)}`
}

function rows({
	state,
	targetK,
	unitSystem,
}: GcmTargetViewRequest): GcmBalanceRow[] {
	const last = state.history[state.history.length - 1]
	return [
		{
			label: "Temperature target",
			value: formatTemperature(targetK - 273.15, unitSystem),
		},
		{
			label: "Trial mean",
			value:
				state.meanTemperatureK === null
					? "Waiting for complete years"
					: formatTemperature(state.meanTemperatureK - 273.15, unitSystem),
		},
		{ label: "Current CO₂", value: formatWithUnit(state.co2Ppm, "ppm", 3) },
		{
			label:
				state.status === "adjusting" ? "Next CO₂ change" : "Last CO₂ change",
			value: last
				? `${formatWithUnit(last.fromCo2Ppm, "ppm", 3)} → ${formatWithUnit(last.toCo2Ppm, "ppm", 3)} (${signedPpm(last.toCo2Ppm - last.fromCo2Ppm)})`
				: "No adjustments yet",
		},
		{
			label: "Total CO₂ change",
			value: signedPpm(state.co2Ppm - state.initialCo2Ppm),
		},
		{
			label: "Targeting",
			value: `${state.status} · ${state.history.length} adjustment${state.history.length === 1 ? "" : "s"} · ${state.yearsAtForcing} year${state.yearsAtForcing === 1 ? "" : "s"} at this CO₂`,
		},
	]
}

export const GCM_TARGETING_VIEW = { rows }
