import { GCM_ATMOSPHERE } from "@/model/climate/gcm/atmosphere"
import type {
	GcmNamelistApplication,
	GcmNamelistEdits,
	GcmNamelistRead,
} from "@/model/climate/gcm/namelist/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

// Mirrors ExoPlaSim's Python Model.configure() namelist writes
// (exoplasim/__init__.py at 5f8dff4) for the parameters exposed here.
const EARTH_RADIUS_M = 6371220
const NSTPW_WINDOW_MINUTES = 7200
const SECONDS_PER_DAY = 86400
const FILTER_KAPPA = 8
const FILTER_POWER = 8
const FILTER_LANDHOSKINS_N0 = 15
const SOIL_LAYER_DEPTHS_M = [0.4, 0.8, 1.6, 3.2, 6.4]
const VEGETATION_DEFAULTS = {
	NCVEG: "1",
	FORGROW: "1.0",
	RINIDSC: "1.0",
	RINIDMR: "2.0",
	RINISOIL: "0.0",
	RINIVEG: "0.0",
} as const

const FILTER_SWITCHES = {
	gp: ["NGPTFILTER", "1"],
	sp: ["NSPVFILTER", "1"],
	none: ["NFILTER", "0"],
	cesaro: ["NFILTER", "1"],
	exp: ["NFILTER", "2"],
	lh: ["NFILTER", "3"],
} as const

function flag(value: boolean): string {
	return value ? "1" : "0"
}

function edits(config: GcmConfig): GcmNamelistEdits {
	const atmosphere = GCM_ATMOSPHERE.resolve(config.atmosphere)
	if (atmosphere.ok === false) throw new Error(atmosphere.message)
	const { pressureBar, gasConstant, co2Ppm } = atmosphere.values
	const stellarAlbedo = config.starTemperatureK > 0
	const planet: Record<string, string> = {
		GA: String(config.gravityMs2),
		PLARAD: String(config.radiusEarth * EARTH_RADIUS_M),
		GSOL0: String(config.fluxWm2),
		ECCEN: String(config.eccentricity),
		OBLIQ: String(config.obliquityDeg),
		NFIXORB: flag(config.fixedOrbit),
		NGENKEPLERIAN: flag(config.keplerian),
		GASCON: String(gasConstant),
		SIDEREAL_YEAR: String(config.yearDays * SECONDS_PER_DAY),
	}
	if (config.layers !== 5 && config.layers !== 10)
		throw new Error("Choose 5 or 10 atmospheric layers")
	for (const value of [
		config.periapseLongitudeDeg,
		config.initialMeanAnomalyDeg,
	]) {
		if (
			value !== null &&
			(!Number.isFinite(value) || value < -360 || value > 360)
		)
			throw new Error(
				"Orbital angles must be finite and between -360 and 360 degrees",
			)
	}
	if (config.periapseLongitudeDeg !== null) {
		if (config.periapseLongitudeDeg < 0)
			throw new Error("Periapse longitude must be between 0 and 360 degrees")
		planet.MVELP = String(config.periapseLongitudeDeg)
	}
	if (config.initialMeanAnomalyDeg !== null)
		planet.MEANANOM0 = String(config.initialMeanAnomalyDeg)
	const plasim: Record<string, string> = {
		FIXEDLON: String(config.substellarLongitudeDeg),
		N_DAYS_PER_YEAR: String(config.yearDays),
		PSURF: String(pressureBar * 1e5),
		NVEG: String(config.vegetation),
		NEQSIG: "0",
		MPSTEP: String(config.timestepMinutes),
		NSTPW: String(Math.floor(NSTPW_WINDOW_MINUTES / config.timestepMinutes)),
		FILTERKAPPA: String(FILTER_KAPPA),
		NFILTEREXP: String(FILTER_POWER),
		LANDHOSKN0: String(FILTER_LANDHOSKINS_N0),
	}
	if (config.layers === 5) plasim.NSELA = "0"
	if (config.rotationPeriodDays !== 1) {
		planet.ROTSPD = String(1 / config.rotationPeriodDays)
		plasim.N_DAYS_PER_YEAR = String(
			Math.max(
				Math.floor(config.yearDays / config.rotationPeriodDays / 12 + 0.5),
				1,
			) * 12,
		)
	}
	plasim.N_START_YEAR = plasim.N_DAYS_PER_YEAR === "365" ? "1" : "0"
	for (const filter of config.physicsFilter) {
		const [key, value] = FILTER_SWITCHES[filter]
		plasim[key] = value
	}
	const land: Record<string, string> = {
		NWETSOIL: flag(config.wetSoil && !stellarAlbedo),
	}
	for (const value of [
		config.soilDepthScale,
		config.soilWaterCapacityM,
		config.soilHeatCapacity,
	]) {
		if (value !== null && (!Number.isFinite(value) || value <= 0)) {
			throw new Error(
				"Soil depth, water capacity and heat capacity must be positive",
			)
		}
	}
	land.DSOILZ = SOIL_LAYER_DEPTHS_M.map(
		(depth) => depth * config.soilDepthScale,
	).join(",")
	if (config.soilWaterCapacityM !== null)
		land.WSMAX = String(config.soilWaterCapacityM)
	if (config.soilHeatCapacity !== null)
		land.SOILCAP = String(config.soilHeatCapacity)
	const sea: Record<string, string> = {}
	for (const value of [
		config.landAlbedo,
		config.oceanAlbedo,
		config.snowIceAlbedo,
	]) {
		if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
			throw new Error("Albedo overrides must be between 0 and 1")
		}
	}
	if (config.landAlbedo !== null) {
		land.ALBLAND = String(config.landAlbedo)
		land.DGROUNDALB = `${config.landAlbedo},${config.landAlbedo}`
	}
	if (config.oceanAlbedo !== null) {
		sea.ALBSEA = String(config.oceanAlbedo)
		sea.DOCEANALB = `${config.oceanAlbedo},${config.oceanAlbedo}`
	}
	if (config.snowIceAlbedo !== null) {
		const value = String(config.snowIceAlbedo)
		const bands = `${value},${value}`
		Object.assign(sea, { ALBICE: value, DICEALBMN: bands, DICEALBMX: bands })
		Object.assign(land, {
			DSNOWALBMN: bands,
			DGLACALBMN: bands,
			DSNOWALB: bands,
		})
	}
	return {
		planet_namelist: planet,
		plasim_namelist: plasim,
		radmod_namelist: {
			NFIXED: flag(config.synchronous),
			...(stellarAlbedo
				? { NSTARTEMP: "1", STARBBTEMP: String(config.starTemperatureK) }
				: {}),
			NO3: flag(config.atmosphere.ozone),
			NRADINT: "1",
			CO2: String(co2Ppm),
			NPBROADEN: "1",
			NECHAM: "1",
			NECHAM6: "0",
		},
		landmod_namelist: land,
		...(Object.keys(sea).length > 0 ? { seamod_namelist: sea } : {}),
		oceanmod_namelist: { MLDEPTH: String(config.oceanDepthM) },
		vegmod_namelist: {
			...VEGETATION_DEFAULTS,
			RINIDAGG: String(config.initialGrowth),
		},
		hurricane_namelist: { NSTORMDIAG: flag(config.stormclim), HC_CAPTURE: "0" },
		glacier_namelist: {
			NGLACIER: flag(config.glaciers.enabled),
			GLACELIM: String(config.glaciers.minDepthM),
			ICESHEETH: String(config.glaciers.initialHeightM),
		},
	}
}

function apply({ text, values }: GcmNamelistApplication): string {
	let result = text
	for (const [key, value] of Object.entries(values)) {
		const line = ` ${key} = ${value}`
		const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "im")
		result = pattern.test(result)
			? result.replace(pattern, line)
			: result.replace(/^\s*\/END/im, `${line}\n /END`)
	}
	return result
}

// A namelist file's "KEY = value" lines, keys upper-cased and values as
// written (comma lists such as SEED stay one string). The group header and
// /END are skipped.
function parse(text: string): Record<string, string> {
	const values: Record<string, string> = {}
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
		if (match) values[match[1].toUpperCase()] = match[2]
	}
	return values
}

function number(text: string): number {
	return Number(text.trim().replace(/d/i, "e"))
}

// The defaults with every value the namelist sets, as Fortran's namelist
// read leaves them: arrays are filled from the front.
function read<T extends Record<string, number | number[]>>({
	text,
	defaults,
}: GcmNamelistRead<T>): T {
	const values = parse(text ?? "")
	const result: Record<string, number | number[]> = { ...defaults }
	for (const [key, fallback] of Object.entries(defaults)) {
		const value = values[key.toUpperCase()]
		if (value === undefined) continue
		const parts = value.split(",").map(number)
		if (Array.isArray(fallback)) {
			const array = [...fallback]
			parts.forEach((part, i) => {
				array[i] = part
			})
			result[key] = array
		} else result[key] = parts[0]
	}
	return result as T
}

export const GCM_NAMELIST = {
	edits,
	apply,
	parse,
	read,
	wetSoilOverridden(config: GcmConfig): boolean {
		return config.wetSoil && config.starTemperatureK > 0
	},
}
