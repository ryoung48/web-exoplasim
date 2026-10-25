import { useMemo } from "react"
import { KOPPEN } from "@/model/climate/classification/koppen"
import { cx } from "@/ui/components/lib"
import { Swatch } from "@/ui/components/primitives/Swatch"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_PERIOD_VIEW } from "@/ui/gcm/period-view"
import { rgbToCss } from "@/ui/genesis/shared/ui-format"

interface GcmKoppenLegendProps {
	classes: Uint8Array
}

export function GcmKoppenLegend({ classes }: GcmKoppenLegendProps) {
	const entries = useMemo(
		() => GCM_PERIOD_VIEW.koppenEntries(classes),
		[classes],
	)
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1">
			{entries.map(({ classId }) => (
				<span
					key={classId}
					title={KOPPEN.koppenClimateName(classId)}
					className={cx(
						"inline-flex items-center gap-1",
						uiTokens.type.valueSm,
						uiTokens.text.muted,
					)}
				>
					<Swatch
						color={rgbToCss(KOPPEN.koppenClimateColor(classId))}
						size="md"
					/>
					{KOPPEN.koppenLabels[classId]}
				</span>
			))}
		</div>
	)
}
