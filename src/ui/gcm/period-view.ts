import { GCM_AVERAGES } from "@/model/climate/gcm/averages"
import type { GcmDate } from "@/model/climate/gcm/types"
import type {
	GcmClimateEntry,
	GcmPeriodRequest,
	GcmPeriodView,
} from "@/ui/gcm/types"

const OCEAN_CLASS = 0
const MONTH_FORMAT = new Intl.DateTimeFormat("en", { month: "short" })

function pad(value: number): string {
	return String(value).padStart(2, "0")
}

function monthName(month: number): string {
	return MONTH_FORMAT.format(new Date(2000, month - 1, 1))
}

function instant(date: GcmDate): string {
	return `Year ${date.year} · ${pad(date.month)}-${pad(date.day)} ${pad(date.hour)}:${pad(date.minute)}`
}

function select({
	period,
	monthIndex,
	snapshot,
	averages,
}: GcmPeriodRequest): GcmPeriodView {
	if (period === "now") {
		return {
			snapshot,
			label: snapshot ? instant(snapshot.date) : "—",
			emptyMessage: "Press Start to spin up the model",
		}
	}
	if (period === "month") {
		const { months } = averages
		const month = months[monthIndex ?? months.length - 1]
		return {
			snapshot: month?.snapshot ?? null,
			label: month
				? `${monthName(month.month)} mean · year ${month.year}`
				: "—",
			emptyMessage: "Monthly means appear when the first model month ends",
		}
	}
	const last = averages.months[averages.months.length - 1]
	return {
		snapshot: averages.annual,
		label: last
			? `12-month mean ending ${monthName(last.month)} · year ${last.year}`
			: "—",
		emptyMessage: `Annual means need ${GCM_AVERAGES.MONTHS_PER_YEAR} model months (${averages.months.length} done)`,
	}
}

function climateEntries(classes: Uint8Array): GcmClimateEntry[] {
	const counts = new Map<number, number>()
	for (const classId of classes) {
		if (classId !== OCEAN_CLASS)
			counts.set(classId, (counts.get(classId) ?? 0) + 1)
	}
	return [...counts]
		.map(([classId, cells]) => ({ classId, cells }))
		.toSorted((a, b) => a.classId - b.classId)
}

export const GCM_PERIOD_VIEW = {
	monthName,
	select,
	climateEntries,
}
