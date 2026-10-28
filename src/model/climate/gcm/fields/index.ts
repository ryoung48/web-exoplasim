import type {
	GcmAtmosphereSelection,
	GcmAtmosphereVariable,
	GcmFieldId,
	GcmFieldRequest,
	GcmLevel,
	GcmMapMode,
	GcmModeDefinition,
	GcmModeRequest,
	GcmScaling,
	GcmVectorField,
} from "@/model/climate/gcm/fields/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmLayerCount, GcmSnapshot } from "@/model/climate/gcm/types"

const LEVELS: ReadonlyArray<GcmLevel> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// Order written by scripts/exoplasim-wasm/gcm_publish.f90.
const ORDER: ReadonlyArray<GcmFieldId> = [
	"surfaceTemperature",
	"airTemperature",
	"windU",
	"windV",
	"cloudCover",
	"precipitation",
	"surfacePressure",
	"waterVapor",
	"seaIce",
	"snowDepth",
	"soilWater",
	"albedo",
	"jetU",
	"jetV",
	"outgoingLongwave",
	"landFraction",
	"toaNetRadiation",
	"surfaceNetHeat",
	"evaporation",
	"runoff",
	"forestCover",
	"leafAreaIndex",
	"snowfall",
	"snowmelt",
	"seaIceThickness",
	"glacierCover",
	"seaLevelPressure",
	"surfaceShortwave",
	"surfaceLongwave",
	"sensibleHeatFlux",
	"latentHeatFlux",
	"convectivePrecipitation",
	"largeScalePrecipitation",
	"toaShortwave",
	"toaLongwave",
	"airTemperatureMin",
	"airTemperatureMax",
	"diurnalTemperatureRange",
	"dailyTemperatureRangeSum",
	"dailyTemperatureRangeDays",
	...LEVELS.flatMap((level): GcmFieldId[] => [
		`layerTemperature${level}`,
		`layerWindU${level}`,
		`layerWindV${level}`,
		`layerHumidity${level}`,
		`layerCloud${level}`,
	]),
]

const KELVIN_OFFSET = 273.15
const MILLIMETERS_PER_DAY_PER_METER_PER_SECOND = 86400 * 1000

// Fixed display ranges keep colors stable while the model spins up.
const MODES: ReadonlyArray<GcmModeDefinition> = [
	{
		mode: "diurnalTemperatureRange",
		label: "Daily temperature range · 2 m air",
		unit: "celsiusDelta",
		min: 0,
		max: 30,
	},
	{
		mode: "convectivePrecipitation",
		label: "Convective precipitation",
		unit: "millimetersPerDay",
		min: 0,
		max: 20,
	},
	{
		mode: "largeScalePrecipitation",
		label: "Large-scale precipitation",
		unit: "millimetersPerDay",
		min: 0,
		max: 20,
	},
	{
		mode: "toaShortwave",
		label: "TOA net shortwave (downward)",
		unit: "wattsPerSquareMeter",
		min: 0,
		max: 1400,
	},
	{
		mode: "toaLongwave",
		label: "TOA net longwave (downward)",
		unit: "wattsPerSquareMeter",
		min: -400,
		max: 0,
	},
	{
		mode: "surfaceShortwave",
		label: "Net surface solar",
		unit: "wattsPerSquareMeter",
		min: 0,
		max: 1000,
	},
	{
		mode: "surfaceLongwave",
		label: "Net surface thermal",
		unit: "wattsPerSquareMeter",
		min: -300,
		max: 300,
	},
	{
		mode: "sensibleHeatFlux",
		label: "Sensible heat (into surface)",
		unit: "wattsPerSquareMeter",
		min: -300,
		max: 300,
	},
	{
		mode: "latentHeatFlux",
		label: "Latent heat (into surface)",
		unit: "wattsPerSquareMeter",
		min: -500,
		max: 500,
	},
	{
		mode: "seaLevelPressure",
		label: "Sea-level pressure",
		unit: "hectopascals",
		min: 960,
		max: 1040,
	},
	{
		mode: "surfaceTemperature",
		label: "Surface temp",
		unit: "celsius",
		min: -50,
		max: 40,
	},
	{
		mode: "airTemperature",
		label: "Air temp",
		unit: "celsius",
		min: -50,
		max: 40,
	},
	{
		mode: "wind",
		label: "Lowest-layer wind",
		unit: "metersPerSecond",
		min: 0,
		max: 20,
	},
	{
		mode: "jet",
		label: "Jet stream",
		unit: "metersPerSecond",
		min: 0,
		max: 60,
	},
	{ mode: "cloudCover", label: "Clouds", unit: "percent", min: 0, max: 100 },
	{
		mode: "precipitation",
		label: "Precipitation",
		unit: "millimetersPerDay",
		min: 0,
		max: 20,
	},
	{
		mode: "surfacePressure",
		label: "Pressure",
		unit: "hectopascals",
		min: 960,
		max: 1040,
	},
	{
		mode: "waterVapor",
		label: "Water vapor",
		unit: "kilogramsPerSquareMeter",
		min: 0,
		max: 60,
	},
	{ mode: "seaIce", label: "Sea ice", unit: "percent", min: 0, max: 100 },
	{ mode: "snowDepth", label: "Snow", unit: "centimeters", min: 0, max: 50 },
	{
		mode: "snowfall",
		label: "Snowfall (water equivalent)",
		unit: "millimetersPerDay",
		min: 0,
		max: 20,
	},
	{
		mode: "snowmelt",
		label: "Snowmelt (water equivalent)",
		unit: "millimetersPerDay",
		min: 0,
		max: 20,
	},
	{
		mode: "seaIceThickness",
		label: "Sea-ice thickness",
		unit: "millimeters",
		min: 0,
		max: 3000,
	},
	{
		mode: "glacierCover",
		label: "Glacier cover",
		unit: "percent",
		min: 0,
		max: 100,
	},
	{
		mode: "soilWater",
		label: "Soil water",
		unit: "millimeters",
		min: 0,
		max: 500,
	},
	{ mode: "albedo", label: "Albedo", unit: "percent", min: 0, max: 80 },
	{
		mode: "outgoingLongwave",
		label: "Outgoing IR",
		unit: "wattsPerSquareMeter",
		min: 100,
		max: 320,
	},
	{
		mode: "toaNetRadiation",
		label: "TOA net radiation",
		unit: "wattsPerSquareMeter",
		min: -1000,
		max: 1000,
	},
	{
		mode: "surfaceNetHeat",
		label: "Surface net heat",
		unit: "wattsPerSquareMeter",
		min: -1000,
		max: 1000,
	},
	{
		mode: "relativeHumidity",
		label: "Lowest-layer relative humidity",
		unit: "percent",
		min: 0,
		max: 100,
	},
	{
		mode: "evaporation",
		label: "Evaporation",
		unit: "millimetersPerDay",
		min: -15,
		max: 15,
	},
	{
		mode: "runoff",
		label: "Runoff",
		unit: "millimetersPerDay",
		min: 0,
		max: 15,
	},
	{
		mode: "forestCover",
		label: "Forest cover",
		unit: "percent",
		min: 0,
		max: 100,
	},
	{
		mode: "leafAreaIndex",
		label: "Leaf area index",
		unit: "dimensionless",
		min: 0,
		max: 10,
	},
	...LEVELS.flatMap((level): GcmModeDefinition[] => [
		{
			mode: `layerCloud${level}`,
			label: `Cloud cover · layer ${level}`,
			unit: "percent",
			min: 0,
			max: 100,
		},
		{
			mode: `layerTemperature${level}`,
			label: `Air temperature · layer ${level}`,
			unit: "celsius",
			min: -90,
			max: 40,
		},
		{
			mode: `layerWind${level}`,
			label: `Wind · layer ${level}`,
			unit: "metersPerSecond",
			min: 0,
			max: 60,
		},
		{
			mode: `layerHumidity${level}`,
			label: `Relative humidity · layer ${level}`,
			unit: "percent",
			min: 0,
			max: 100,
		},
	]),
]

function layer(mode: string): GcmAtmosphereSelection | null {
	const match = /^layer(Temperature|Wind|Humidity|Cloud)(10|[1-9])$/.exec(mode)
	return match
		? {
				variable: match[1] as GcmAtmosphereVariable,
				level: Number(match[2]) as GcmLevel,
			}
		: null
}

function layerMode({ variable, level }: GcmAtmosphereSelection): GcmMapMode {
	return `layer${variable}${level}`
}

function fieldCount(layers: GcmLayerCount): number {
	return ORDER.length - 5 * (10 - layers)
}

function levels(layers: GcmLayerCount): ReadonlyArray<GcmLevel> {
	return LEVELS.slice(0, layers)
}

function grid(snapshot: GcmSnapshot): GcmGrid {
	return GCM_GRID.forPoints(
		snapshot.values.length / fieldCount(snapshot.layers),
	)
}

function field({ snapshot, field: id }: GcmFieldRequest): Float32Array {
	const { points } = grid(snapshot)
	const index = ORDER.indexOf(id)
	if (index < 0 || index >= fieldCount(snapshot.layers))
		throw new Error(
			`Field ${id} is unavailable with ${snapshot.layers} atmospheric layers`,
		)
	const start = index * points
	return snapshot.values.subarray(start, start + points)
}

function mapScaled({ values, scale, offset }: GcmScaling): Float32Array {
	return values.map((value) => value * scale + offset)
}

function speed(vectors: GcmVectorField): Float32Array {
	return vectors.u.map((u, index) => Math.hypot(u, vectors.v[index]))
}

function vectors(request: GcmModeRequest): GcmVectorField | null {
	const { snapshot, mode } = request
	const selection = layer(mode)
	if (selection?.variable === "Wind")
		return {
			u: field({ snapshot, field: `layerWindU${selection.level}` }),
			v: field({ snapshot, field: `layerWindV${selection.level}` }),
		}
	if (mode === "wind") {
		return {
			u: field({ snapshot, field: "windU" }),
			v: field({ snapshot, field: "windV" }),
		}
	}
	if (mode === "jet") {
		return {
			u: field({ snapshot, field: "jetU" }),
			v: field({ snapshot, field: "jetV" }),
		}
	}
	return null
}

function values(request: GcmModeRequest): Float32Array {
	const { snapshot, mode } = request
	const read = (id: GcmFieldId) => field({ snapshot, field: id })
	const selection = layer(mode)
	if (selection) {
		if (selection.variable === "Wind")
			return speed(vectors(request) as GcmVectorField)
		return mapScaled({
			values: read(`layer${selection.variable}${selection.level}`),
			scale: selection.variable === "Temperature" ? 1 : 100,
			offset: selection.variable === "Temperature" ? -KELVIN_OFFSET : 0,
		})
	}
	switch (mode) {
		case "diurnalTemperatureRange": {
			const sum = read("dailyTemperatureRangeSum")
			const days = read("dailyTemperatureRangeDays")
			return read(mode).map((value, point) =>
				days[point] > 0 ? sum[point] / days[point] : value,
			)
		}
		case "surfaceTemperature":
		case "airTemperature":
			return mapScaled({ values: read(mode), scale: 1, offset: -KELVIN_OFFSET })
		case "wind":
		case "jet":
			return speed(vectors(request) as GcmVectorField)
		case "relativeHumidity":
			return mapScaled({
				values: read(`layerHumidity${snapshot.layers}`),
				scale: 100,
				offset: 0,
			})
		case "forestCover":
		case "glacierCover":
		case "cloudCover":
		case "seaIce":
		case "albedo":
			return mapScaled({ values: read(mode), scale: 100, offset: 0 })
		case "evaporation":
		case "snowfall":
		case "snowmelt":
		case "runoff":
		case "convectivePrecipitation":
		case "largeScalePrecipitation":
		case "precipitation":
			return mapScaled({
				values: read(mode),
				scale: MILLIMETERS_PER_DAY_PER_METER_PER_SECOND,
				offset: 0,
			})
		case "seaLevelPressure":
		case "surfacePressure":
			return mapScaled({ values: read(mode), scale: 0.01, offset: 0 })
		case "snowDepth":
			return mapScaled({ values: read(mode), scale: 100, offset: 0 })
		case "soilWater":
		case "seaIceThickness":
			return mapScaled({ values: read(mode), scale: 1000, offset: 0 })
		case "toaShortwave":
		case "toaLongwave":
		case "toaNetRadiation":
		case "surfaceShortwave":
		case "surfaceLongwave":
		case "sensibleHeatFlux":
		case "latentHeatFlux":
		case "surfaceNetHeat":
		case "leafAreaIndex":
		case "waterVapor":
		case "outgoingLongwave":
			return read(mode)
	}
	throw new Error(`Unknown map mode: ${mode}`)
}

function gpuSupports(mode: GcmMapMode): boolean {
	return mode !== "seaLevelPressure" && layer(mode)?.variable !== "Humidity"
}

export const GCM_FIELDS = {
	gpuSupports,
	fieldCount,
	levels,
	layer,
	layerMode,
	grid,
	MODES,
	definition(mode: GcmMapMode): GcmModeDefinition {
		return MODES.find((entry) => entry.mode === mode) as GcmModeDefinition
	},
	field,
	values,
	vectors,
}
