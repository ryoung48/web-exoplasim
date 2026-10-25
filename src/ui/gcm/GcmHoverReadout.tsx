import { cx } from "@/ui/components/lib"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_HOVER } from "@/ui/gcm/hover"
import type { GcmHoverReadoutProps } from "@/ui/gcm/hover/types"

export function GcmHoverReadout({
	point,
	readLayer,
	unitSystem,
}: GcmHoverReadoutProps) {
	const layer = readLayer()
	const rows =
		point && layer ? GCM_HOVER.rows({ point, layer, unitSystem }) : []
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
				</>
			)}
		</div>
	)
}
