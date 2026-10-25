import { GCM_BALANCE } from "@/model/climate/gcm/balance"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmFieldId } from "@/model/climate/gcm/fields/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import type { GcmAverageState, GcmBalanceRow } from "@/ui/gcm/types"
import { formatWithUnit } from "@/ui/genesis/shared/ui-format"

const MILLIWATTS_PER_WATT = 1000

function signed(value: number): string {
	return `${value >= 0 ? "+" : ""}${formatWithUnit(value, "W/m²", 2)}`
}

function rows(averages: GcmAverageState): GcmBalanceRow[] {
	const month = averages.months[averages.months.length - 1]
	const monthMean = (field: GcmFieldId) =>
		month
			? GCM_GRID.globalMean(
					GCM_FIELDS.field({ snapshot: month.snapshot, field }),
				)
			: Number.NaN
	const assessment = GCM_BALANCE.assess(averages.years)
	const threshold = GCM_BALANCE.THRESHOLD_W_M2_PER_YEAR * MILLIWATTS_PER_WATT
	const drift =
		assessment.status === "spinning-up"
			? `needs ${assessment.yearsNeeded} more year${assessment.yearsNeeded === 1 ? "" : "s"}`
			: `${assessment.status === "balanced" ? "balanced" : "drifting"} · ${formatWithUnit(
					Math.max(assessment.toaDriftPerYear, assessment.surfaceDriftPerYear) *
						MILLIWATTS_PER_WATT,
					"mW/m²/yr",
					2,
				)} (< ${threshold})`
	return [
		{
			label: "Top of atmosphere",
			value: month ? `${signed(monthMean("toaNetRadiation"))} last month` : "—",
		},
		{
			label: "Surface",
			value: month ? `${signed(monthMean("surfaceNetHeat"))} last month` : "—",
		},
		{ label: "Equilibrium", value: drift },
	]
}

export const GCM_BALANCE_VIEW = {
	rows,
}
