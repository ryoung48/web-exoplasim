import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_HOVER } from "@/ui/gcm/hover"
import type { GcmHoverReadoutProps } from "@/ui/gcm/hover/types"
import { GCM_PERIOD_VIEW } from "@/ui/gcm/period-view"

export function GcmHoverReadout({
	point,
	readLayer,
	readMonths,
	unitSystem,
}: GcmHoverReadoutProps) {
	const layer = readLayer()
	const rows =
		point && layer ? GCM_HOVER.rows({ point, layer, unitSystem }) : []
	const months = point
		? GCM_HOVER.monthly({ point, months: readMonths(), unitSystem })
		: []
	const max = Math.max(0, ...months.map((month) => month.value))
	const min = Math.min(0, ...months.map((month) => month.value))
	const range = max - min || 1
	return (
		<div
			className={cx(
				"absolute right-0 top-full flex w-max flex-col items-end leading-tight",
				uiTokens.type.valueSm,
			)}
		>
			{rows.length === 0 ? (
				<span className={uiTokens.text.muted}>Hover map to inspect</span>
			) : (
				<>
					<div className="flex gap-x-3">
						{rows.slice(0, 2).map(({ label, value }) => (
							<span key={label} className="whitespace-nowrap">
								<span className={uiTokens.text.muted}>{label} </span>
								<span className={uiTokens.text.primary}>{value}</span>
							</span>
						))}
					</div>
					{rows.slice(2).map(({ label, value }) => (
						<div key={label}>
							<span className={uiTokens.text.muted}>{label} </span>
							<span className={uiTokens.text.primary}>{value}</span>
						</div>
					))}
					{months.length > 0 && (
						<div className="pointer-events-none mt-2 w-64 pt-3 text-left">
							<div
								className="relative mt-1 flex h-10 gap-px"
								role="img"
								aria-label={months
									.map(
										({ month, year, formatted }) =>
											`${GCM_PERIOD_VIEW.monthName(month)} year ${year}: ${formatted}`,
									)
									.join(", ")}
							>
								{months.map(({ month, year, value, formatted, color }) => (
									<div
										key={`${year}-${month}`}
										className="relative h-full flex-1"
									>
										<span
											className={cx(
												"absolute left-1/2 -translate-x-1/2 whitespace-nowrap",
												uiTokens.type.chartValue,
												uiTokens.text.primary,
											)}
											style={{
												bottom: `calc(${((value >= 0 ? -min + value : -min) / range) * 100}% + 2px)`,
											}}
										>
											{formatted.split(" ")[0]}
										</span>
										<div
											className="absolute inset-x-0"
											style={{
												backgroundColor: color,
												height: `${(Math.abs(value) / range) * 100}%`,
												bottom: `${((value >= 0 ? -min : -min + value) / range) * 100}%`,
											}}
										/>
									</div>
								))}
							</div>
							<div
								className={cx(
									"mt-1 flex gap-px text-center",
									uiTokens.type.valueSm,
									uiTokens.text.muted,
								)}
								aria-hidden="true"
							>
								{months.map(({ month, year }) => (
									<span className="flex-1" key={`${year}-${month}`}>
										{GCM_PERIOD_VIEW.monthName(month)[0]}
									</span>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	)
}
