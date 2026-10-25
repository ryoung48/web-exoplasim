import { KOPPEN } from "@/model/climate/classification/koppen"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import { GCM_DISPLAY } from "@/ui/gcm/field-display"
import { GCM_FIELD_SAMPLE } from "@/ui/gcm/field-sample"
import type { GcmHoverRequest, GcmHoverRow } from "@/ui/gcm/hover/types"
import { COORDINATES } from "@/ui/genesis/shared/coordinates"

function rows({ point, layer, unitSystem }: GcmHoverRequest): GcmHoverRow[] {
	const [latitude, longitude] = COORDINATES.format(point)
	const value = GCM_FIELD_SAMPLE.value({ layer, point })
	const field =
		layer.kind === "terrain"
			? { label: "Elevation", value: `${Math.round(value).toLocaleString()} m` }
			: layer.kind === "field" || layer.kind === "downscaled-field"
				? {
						label: GCM_FIELDS.definition(layer.mode).label,
						value: GCM_DISPLAY.format({ mode: layer.mode, value, unitSystem }),
					}
				: { label: "Köppen", value: KOPPEN.koppenClimateName(value) }
	return [
		{
			label: "Lat",
			value: latitude,
		},
		{
			label: "Lon",
			value: longitude,
		},
		field,
	]
}

export const GCM_HOVER = { rows }
