import type {
	GcmNamelistApplication,
	GcmNamelistEdits,
} from "@/model/climate/gcm/namelist/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

// Mirrors ExoPlaSim's Python Model.configure() namelist writes
// (exoplasim/__init__.py at 5f8dff4) for the parameters exposed here.
const MOLAR_MASS = { N2: 28.0134, O2: 31.9988, Ar: 39.948 } as const
const UNIVERSAL_GAS_CONSTANT = 8314.46261815324
const DEFAULT_CO2_PPMV = 300
const NSTPW_WINDOW_MINUTES = 7200
const SECONDS_PER_DAY = 86400
const FILTER_KAPPA = 8
const FILTER_POWER = 8
const FILTER_LANDHOSKINS_N0 = 15
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
	const pressureBar = config.pN2Bar + config.pO2Bar + config.pArBar
	const meanMolecularWeight =
		(config.pN2Bar * MOLAR_MASS.N2 +
			config.pO2Bar * MOLAR_MASS.O2 +
			config.pArBar * MOLAR_MASS.Ar) /
		pressureBar
	const stellarAlbedo = config.starTemperatureK > 0
	const planet: Record<string, string> = {
		GSOL0: String(config.fluxWm2),
		ECCEN: String(config.eccentricity),
		OBLIQ: String(config.obliquityDeg),
		NFIXORB: flag(config.fixedOrbit),
		GASCON: String(UNIVERSAL_GAS_CONSTANT / meanMolecularWeight),
		SIDEREAL_YEAR: String(config.yearDays * SECONDS_PER_DAY),
	}
	const plasim: Record<string, string> = {
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
	if (config.rotationPeriodDays !== 1) {
		planet.ROTSPD = String(1 / config.rotationPeriodDays)
		plasim.N_DAYS_PER_YEAR = String(
			Math.max(Math.floor(360 / config.rotationPeriodDays / 12 + 0.5), 1) * 12,
		)
	}
	for (const filter of config.physicsFilter) {
		const [key, value] = FILTER_SWITCHES[filter]
		plasim[key] = value
	}
	return {
		planet_namelist: planet,
		plasim_namelist: plasim,
		radmod_namelist: {
			...(stellarAlbedo
				? { NSTARTEMP: "1", STARBBTEMP: String(config.starTemperatureK) }
				: {}),
			NO3: flag(config.ozone),
			NRADINT: String(config.radiationIntervalSteps),
			CO2: String(DEFAULT_CO2_PPMV),
			NPBROADEN: "1",
			NECHAM: "1",
			NECHAM6: "0",
		},
		landmod_namelist: {
			NWETSOIL: flag(config.wetSoil && !stellarAlbedo),
		},
		vegmod_namelist: {
			...VEGETATION_DEFAULTS,
			RINIDAGG: String(config.initialGrowth),
		},
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

export const GCM_NAMELIST = {
	edits,
	apply,
	wetSoilOverridden(config: GcmConfig): boolean {
		return config.wetSoil && config.starTemperatureK > 0
	},
}
