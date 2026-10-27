import { useMemo } from "react"
import { GCM_CLASSIFICATION } from "@/model/climate/gcm/classification"
import { cx } from "@/ui/components/lib"
import { Swatch } from "@/ui/components/primitives/Swatch"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_PERIOD_VIEW } from "@/ui/gcm/period-view"
import type { GcmClimateLegendProps } from "@/ui/gcm/types"
import { rgbToCss } from "@/ui/genesis/shared/ui-format"

export function GcmClimateLegend({
	readClasses,
	scheme,
}: GcmClimateLegendProps) {
	const classes = readClasses()
	const definition = GCM_CLASSIFICATION.definition(scheme)
	const entries = useMemo(
		() => (classes ? GCM_PERIOD_VIEW.climateEntries(classes) : []),
		[classes],
	)
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1">
			{entries.map(({ classId }) => (
				<span
					key={classId}
					title={definition.name(classId)}
					className={cx(
						"inline-flex items-center gap-1",
						uiTokens.type.valueSm,
						uiTokens.text.muted,
					)}
				>
					<Swatch color={rgbToCss(definition.color(classId))} size="md" />
					{definition.code(classId)}
				</span>
			))}
		</div>
	)
}
