import type { GcmModeGroup } from "@/ui/gcm/types"

export const GCM_MODE_GROUPS: ReadonlyArray<GcmModeGroup> = [
	{
		label: "Temperature",
		defaultView: "surfaceTemperature",
		children: [
			{ value: "surfaceTemperature", label: "Surface" },
			{ value: "airTemperature", label: "Air" },
		],
	},
	{
		label: "Wind",
		defaultView: "wind",
		children: [
			{ value: "wind", label: "Surface" },
			{ value: "jet", label: "Jet stream" },
		],
	},
	{ label: "Clouds", defaultView: "cloudCover", children: [] },
	{ label: "Rain", defaultView: "precipitation", children: [] },
	{ label: "Pressure", defaultView: "surfacePressure", children: [] },
	{
		label: "Moisture",
		defaultView: "waterVapor",
		children: [
			{ value: "waterVapor", label: "Water vapor" },
			{ value: "soilWater", label: "Soil water" },
		],
	},
	{
		label: "Ice & snow",
		defaultView: "seaIce",
		children: [
			{ value: "seaIce", label: "Sea ice" },
			{ value: "snowDepth", label: "Snow" },
		],
	},
	{
		label: "Radiation",
		defaultView: "albedo",
		children: [
			{ value: "albedo", label: "Albedo" },
			{ value: "outgoingLongwave", label: "Outgoing IR" },
		],
	},
	{ label: "Köppen", defaultView: "koppen", children: [] },
]
