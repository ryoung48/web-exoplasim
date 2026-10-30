import type { GcmModeGroup } from "@/ui/gcm/types"

export const GCM_MODE_GROUPS: ReadonlyArray<GcmModeGroup> = [
	{
		label: "Elevation",
		defaultView: "elevation",
		children: [],
	},
	{
		label: "Temperature",
		defaultView: "airTemperature",
		children: [
			{ value: "surfaceTemperature", label: "Surface" },
			{ value: "airTemperature", label: "2 m air" },
			{ value: "layerTemperature10", label: "Atmosphere" },
			{ value: "diurnalTemperatureRange", label: "DTR" },
		],
	},
	{
		label: "Wind",
		defaultView: "wind",
		children: [
			{ value: "wind", label: "Lowest layer" },
			{ value: "layerWind10", label: "Atmosphere" },
			{ value: "jet", label: "Jet stream" },
		],
	},
	{
		label: "Clouds",
		defaultView: "cloudCover",
		children: [
			{ value: "cloudCover", label: "Total cover" },
			{ value: "layerCloud10", label: "Atmosphere" },
		],
	},
	{
		label: "Water cycle",
		defaultView: "precipitation",
		children: [
			{ value: "precipitation", label: "Precipitation" },
			{ value: "convectivePrecipitation", label: "Convective" },
			{ value: "largeScalePrecipitation", label: "Large-scale" },
			{ value: "evaporation", label: "Evaporation" },
			{ value: "runoff", label: "Runoff" },
		],
	},
	{
		label: "Pressure",
		defaultView: "surfacePressure",
		children: [
			{ value: "surfacePressure", label: "Surface" },
			{ value: "seaLevelPressure", label: "Sea level" },
		],
	},
	{
		label: "Moisture",
		defaultView: "waterVapor",
		children: [
			{ value: "waterVapor", label: "Water vapor" },
			{ value: "relativeHumidity", label: "Relative humidity" },
			{ value: "layerHumidity10", label: "Atmosphere" },
			{ value: "soilWater", label: "Soil water" },
		],
	},
	{
		label: "Ice & snow",
		defaultView: "seaIce",
		children: [
			{ value: "seaIce", label: "Sea ice" },
			{ value: "seaIceThickness", label: "Ice thickness" },
			{ value: "snowDepth", label: "Snowpack" },
			{ value: "snowfall", label: "Snowfall" },
			{ value: "snowmelt", label: "Snowmelt" },
			{ value: "glacierCover", label: "Glaciers" },
		],
	},
	{
		label: "Radiation",
		defaultView: "albedo",
		children: [
			{ value: "solarZenithCosine", label: "Solar zenith cosine" },
			{ value: "albedo", label: "Albedo" },
			{ value: "outgoingLongwave", label: "Outgoing IR" },
			{ value: "toaNetRadiation", label: "TOA net" },
			{ value: "toaShortwave", label: "TOA solar" },
			{ value: "toaLongwave", label: "TOA thermal" },
		],
	},
	{
		label: "Surface energy",
		defaultView: "surfaceNetHeat",
		children: [
			{ value: "surfaceNetHeat", label: "Net heat" },
			{ value: "surfaceShortwave", label: "Solar" },
			{ value: "surfaceLongwave", label: "Thermal" },
			{ value: "sensibleHeatFlux", label: "Sensible" },
			{ value: "latentHeatFlux", label: "Latent" },
		],
	},
	{
		label: "Vegetation",
		defaultView: "forestCover",
		children: [
			{ value: "forestCover", label: "Forest cover" },
			{ value: "leafAreaIndex", label: "Leaf area" },
			{ value: "netPrimaryProduction", label: "Net primary production" },
		],
	},
	{
		label: "Climate",
		defaultView: "koppen",
		children: [
			{ value: "koppen", label: "Köppen" },
			{ value: "pasta", label: "Pasta" },
		],
	},
]
