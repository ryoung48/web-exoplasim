import type {
	GcmFieldId,
	GcmFieldRequest,
	GcmMapMode,
	GcmModeDefinition,
	GcmModeRequest,
	GcmScaling,
	GcmVectorField,
} from "@/model/climate/gcm/fields/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import type { GcmGrid } from "@/model/climate/gcm/grid/types"
import type { GcmSnapshot } from "@/model/climate/gcm/types"

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
]

const KELVIN_OFFSET = 273.15
const MILLIMETERS_PER_DAY_PER_METER_PER_SECOND = 86400 * 1000

// Ranges span Earth's observed extremes at T21 resolution so colors stay
// stable while the model spins up.
const MODES: ReadonlyArray<GcmModeDefinition> = [
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
		label: "Surface wind",
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
		label: "Rain",
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
]

function grid(snapshot: GcmSnapshot): GcmGrid {
	return GCM_GRID.forPoints(snapshot.values.length / ORDER.length)
}

function field({ snapshot, field: id }: GcmFieldRequest): Float32Array {
	const { points } = grid(snapshot)
	const start = ORDER.indexOf(id) * points
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
	switch (mode) {
		case "surfaceTemperature":
		case "airTemperature":
			return mapScaled({ values: read(mode), scale: 1, offset: -KELVIN_OFFSET })
		case "wind":
		case "jet":
			return speed(vectors(request) as GcmVectorField)
		case "cloudCover":
		case "seaIce":
		case "albedo":
			return mapScaled({ values: read(mode), scale: 100, offset: 0 })
		case "precipitation":
			return mapScaled({
				values: read(mode),
				scale: MILLIMETERS_PER_DAY_PER_METER_PER_SECOND,
				offset: 0,
			})
		case "surfacePressure":
			return mapScaled({ values: read(mode), scale: 0.01, offset: 0 })
		case "snowDepth":
			return mapScaled({ values: read(mode), scale: 100, offset: 0 })
		case "soilWater":
			return mapScaled({ values: read(mode), scale: 1000, offset: 0 })
		case "waterVapor":
		case "outgoingLongwave":
			return read(mode)
	}
}

export const GCM_FIELDS = {
	grid,
	MODES,
	definition(mode: GcmMapMode): GcmModeDefinition {
		return MODES.find((entry) => entry.mode === mode) as GcmModeDefinition
	},
	field,
	values,
	vectors,
}
