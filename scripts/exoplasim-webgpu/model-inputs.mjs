import fs from "node:fs/promises"
import path from "node:path"
import { readProbe } from "./probe.mjs"

// The GPU model's inputs from a Fortran probe dump: STEPPER's constants,
// tables and step calendar under the Fortran variable names. Shared by
// verify-dynamics.mjs (one routine from each dump) and
// verify-trajectory.mjs (whole steps from one dump).

// State fields that hold another module's variable, by dump name.
export const ALIASES = {
	dtransh: "fluxmod.dtransh",
	dtransm: "fluxmod.dtransm",
	gmu0: "radmod.gmu0",
	...Object.fromEntries(["icclev", "icctot", "dprcl", "dprll", "dprscl", "dprsll"].map((name) => [name, `rainmod.${name}`])),
	...Object.fromEntries(["dts", "dtsm", "dqs"].map((name) => [`land_${name}`, `landmod.${name}`])),
	...Object.fromEntries(["driver", "duroff", "dvroff", "darea", "dsoilt", "dsnowt", "dsnowz", "dwater", "dz0climo", "dalbclim", "dalbclim1", "dalbclim2", "dalbcl", "dalbcl1", "dalbcl2"].map((name) => [name, `landmod.${name}`])),
	...Object.fromEntries(["dcveg", "dcsoil", "dlai", "dvsoil", "dagg", "dgrow", "dsc", "dmr"].map((name) => [name, `vegmod.${name}`])),
	...Object.fromEntries(["xts", "xsst", "xmld", "xls", "xiced", "xicec", "xsnow", "xqmelt", "xicecc", "xcflux", "xcfluxf", "xoheat", "xoflux", "xgw", "xclsst2", "xclicec2", "xcliced2", "xclssto", "xclsst", "xclicec", "xcliced"].map((name) => [name, `icemod.${name}`])),
	...Object.fromEntries(["ysst", "ymld", "yls", "yfldo", "yclsst2", "yclsst"].map((name) => [name, `oceanmod.${name}`])),
	...Object.fromEntries(["dts", "dqs", "dsst", "cheata", "cprsa", "naccua"].map((name) => [`sea_${name}`, `seamod.${name}`])),
	...Object.fromEntries(["localprecip", "localavgprecip", "localweathering", "localavgweather", "localavgtemps"].map((name) => [name, `carbonmod.${name}`])),
}
// Fields Fortran stores as (bands, NHOR); the GPU keeps each band contiguous.
const BANDS = { dsalb: 2 }
// Fortran scalars the GPU keeps per point.
const PER_POINT = new Set(["sea_naccua"])

// A state field's values from a dump, in the GPU's layout.
export function dumped(dump, name) {
	const values = dump[ALIASES[name] ?? name]
	if (values && PER_POINT.has(name)) return new Array(dump.dls.length).fill(values[0])
	const bands = BANDS[name]
	if (!values || !bands) return values
	const points = values.length / bands
	return Array.from(values, (_, i) => values[(i % points) * bands + Math.floor(i / points)])
}

// DYNAMICS.TABLES from the TypeScript set-up port (checked by
// verify-setup.mjs) for this delt; sop and srp come from the dump, as part
// of the state being replayed (SETUP.state ports them, verify-initial-state).
async function dynamicsTables({ modules, probeRoot, truncation, delt, dump }) {
	const { DYNAMICS, DYNAMICS_SETUP, GRID } = modules
	const input = await readProbe(path.join(probeRoot, `setup-earth-t${truncation}`, "probe-initpm-in"))
	const scalar = (key) => input[key][0]
	const setup = DYNAMICS_SETUP.initpm({ truncation, levels: scalar("NLEV"), neqsig: scalar("neqsig"), restim: input.restim, tfrc: input.tfrc, tdissd: input.tdissd, tdissz: input.tdissz, tdisst: input.tdisst, tdissq: input.tdissq, ndel: input.ndel, nhdiff: scalar("nhdiff"), dayLengthS: scalar("day_24hr"), stepsPerDay: scalar("mtspd"), t0: input.t0, dtns: scalar("dtns"), dtep: scalar("dtep"), dttrp: scalar("dttrp"), ct: scalar("ct"), akap: scalar("akap") })
	const ported = DYNAMICS_SETUP.tables({ setup, bm1: DYNAMICS_SETUP.makebm({ setup, truncation, delt }), rcsq: DYNAMICS_SETUP.latitudeFactors({ grid: GRID.forLatitudes(scalar("NLAT")) }) })
	return Object.fromEntries(DYNAMICS.TABLES.map(({ name }) => [name, Array.from(ported[name] ?? dump[name])]))
}

// STEPPER.tables' request, serializable: plain arrays instead of typed ones.
export async function tablesInputs({ modules, probeRoot, truncation, dump }) {
	return {
		...physicsTablesInputs({ truncation, dump }),
		dynamics: await dynamicsTables({ modules, probeRoot, truncation, delt: dump.delt[0], dump }),
	}
}

// The request's inputs other than DYNAMICS.TABLES (SETUP.constants' tables).
export function physicsTablesInputs({ truncation, dump }) {
	const scalar = (name) => dump[name]?.[0]
	return {
		filters: { truncation, ...Object.fromEntries(["nfilter", "ngptfilter", "nspvfilter", "filterkappa", "nfilterexp", "landhoskn0"].map((name) => [name, scalar(name)])) },
		akap: scalar("akap"),
		gascon: scalar("gascon"),
		ga: scalar("ga"),
		vdiffLamm: scalar("fluxmod.vdiff_lamm") ?? 0,
		vdiffD: scalar("fluxmod.vdiff_d") ?? 0,
		acllwr: scalar("radmod.acllwr") ?? 0,
		rcritmod: scalar("rainmod.rcritmod") ?? 1,
		rcritslope: scalar("rainmod.rcritslope") ?? 0,
		dsoilz: Array.from(dump["landmod.dsoilz"] ?? [0.4, 0.8, 1.6, 3.2, 6.4]),
	}
}

export function dynamicsConstants(dump) {
	const scalar = (name) => dump[name][0]
	return {
		...Object.fromEntries(["psurf", "ww", "cv", "ct", "akap", "rdbrv", "adv", "acpd", "ga", "plavor", "delt", "delt2", "deltsec2", "pnu", "pnu21"].map((name) => [name, scalar(name)])),
		filter: scalar("nkits") === 0,
	}
}

// STEPPER.kernels' constants for every physics module. Start-up dumps lack
// the physics modules' variables; only main-loop dumps can supply these.
export function stepperConstants(dump) {
	const scalar = (name) => dump[name][0]
	const upper = ({ module, names }) => Object.fromEntries(names.map((name) => [name.toUpperCase(), scalar(`${module}.${name}`)]))
	const pair = ({ name, key }) => ({ [`${key}1`]: dump[name][0], [`${key}2`]: dump[name][1] })
	return {
		dynamics: dynamicsConstants(dump),
		fixer: { delt2: scalar("delt2"), psurf: scalar("psurf") },
		surfaceFlux: { rdbrv: scalar("rdbrv"), gascon: scalar("gascon"), ga: scalar("ga"), acpd: scalar("acpd"), adv: scalar("adv"), deltsec: scalar("deltsec"), deltsec2: scalar("deltsec2"), ra2: scalar("ra2"), ra4: scalar("ra4"), tmelt: scalar("tmelt"), alv: scalar("alv"), als: scalar("als"), zumin: scalar("fluxmod.zumin"), vdiffB: scalar("fluxmod.vdiff_b"), vdiffC: scalar("fluxmod.vdiff_c"), vdiffD: scalar("fluxmod.vdiff_d"), ndheat: scalar("ndheat") > 0 },
		radiation: {
			synchronous: scalar("radmod.nfixed") === 1,
			ga: scalar("ga"), gascon: scalar("gascon"), acpd: scalar("acpd"), adv: scalar("adv"),
			gsol0: scalar("radmod.gsol0"), zsolar1: scalar("radmod.zsolar1"), zsolar2: scalar("radmod.zsolar2"), zsolars1: dump["radmod.zsolars"][0], zsolars2: dump["radmod.zsolars"][1],
			tswr1: scalar("radmod.tswr1"), tswr2: scalar("radmod.tswr2"), tswr3: scalar("radmod.tswr3"), rcoeff: scalar("radmod.rcoeff"),
			nstartemp: scalar("radmod.nstartemp") > 0, ozone: scalar("radmod.no3") === 1,
			a0o3: scalar("radmod.a0o3"), a1o3: scalar("radmod.a1o3"), aco3: scalar("radmod.aco3"), bo3: scalar("radmod.bo3"), co3: scalar("radmod.co3"),
			dawnDeg: scalar("dawn"), sbk: scalar("radmod.SBK"), th2oc: scalar("radmod.th2oc"), tpofmt: scalar("radmod.tpofmt"),
		},
		precipitation: { deltsec2: scalar("deltsec2"), psurf: scalar("psurf"), ww: scalar("ww"), ga: scalar("ga"), gascon: scalar("gascon"), acpd: scalar("acpd"), adv: scalar("adv"), alv: scalar("alv"), als: scalar("als"), rdbrv: scalar("rdbrv"), ra1: scalar("ra1"), ra2: scalar("ra2"), ra4: scalar("ra4"), tmelt: scalar("tmelt"), rhbeta: scalar("rainmod.rhbeta"), nbeta: scalar("rainmod.nbeta"), pdeep: scalar("rainmod.pdeep"), pdeepth: scalar("rainmod.pdeepth"), rkshallow: scalar("rainmod.rkshallow"), gamma: scalar("rainmod.gamma"), solarDay: scalar("solar_day"), clwfac: scalar("rainmod.clwfac"), clwcrit1: scalar("rainmod.clwcrit1"), clwcrit2: scalar("rainmod.clwcrit2") },
		surface: {
			soil: { DELTSEC: scalar("deltsec"), TMELT: scalar("tmelt"), ALS: scalar("als"), ALV: scalar("alv"), ...upper({ module: "landmod", names: ["sicecap", "soilcap", "sicediff", "soildiff", "snowcap", "snowdiff", "rhosnow", "dztop", "dsmax"] }) },
			land: {
				DELTSEC: scalar("deltsec"), TMELT: scalar("tmelt"), RDBRV: scalar("rdbrv"), RA1: scalar("ra1"), RA2: scalar("ra2"), RA4: scalar("ra4"),
				...upper({ module: "landmod", names: ["albsmax", "albsmin", "albsmaxf", "albsminf", "albsmax1", "albsmin1", "albsmaxf1", "albsminf1", "albsmax2", "albsmin2", "albsmaxf2", "albsminf2", "albgmax", "albgmin", "albgmax1", "albgmin1", "albgmax2", "albgmin2", "drhsfull", "nwetsoil", "wsmax", "albland", "alblandmax"] }),
				...pair({ name: "dgroundalb", key: "DGROUNDALB" }),
				...pair({ name: "doceanalb", key: "DOCEANALB" }),
			},
			vegetation: {
				NVEG: scalar("nveg"), RLUE: scalar("landmod.rlue"), CO2CONV: scalar("landmod.co2conv"), TAU_VEG: scalar("landmod.tau_veg"), TAU_SOIL: scalar("landmod.tau_soil"),
				...upper({ module: "vegmod", names: ["vws_crit", "q10", "zlaimax", "zlaimin", "valb_min", "valb_max", "vsalb_min", "vwmax_max", "vwmax_min", "vz0_min", "cveg_a", "cveg_c", "cveg_d", "cveg_f", "cveg_k", "cveg_l", "ct_crit", "co2_ref", "co2_comp", "co2_sens", "ncveg"] }),
			},
			nglacier: scalar("glaciermod.nglacier") > 0,
			seaCoupled: scalar("nkits") === 0,
			ice: { ...upper({ module: "icemod", names: ["xdt", "xmind", "xmaxd", "cicemin", "thicec"] }), TFREEZE: scalar("icemod.TFREEZE"), TMELT: scalar("icemod.TMELT"), CRHOI: scalar("icemod.CRHOI"), CRHOS: scalar("icemod.CRHOS"), CRHOSN: scalar("icemod.CRHOSN"), CPI: scalar("icemod.CPI"), CKAPI: scalar("icemod.CKAPI"), CKAPSN: scalar("icemod.CKAPSN"), CLFI: scalar("icemod.CLFI"), CLFSN: scalar("icemod.CLFSN") },
			ocean: { DTMIX: scalar("oceanmod.dtmix"), CPS: scalar("oceanmod.CPS") },
			sea: {
				RDBRV: scalar("rdbrv"), RA1: scalar("ra1"), RA2: scalar("ra2"), RA4: scalar("ra4"), GASCON: scalar("gascon"), GA: scalar("ga"),
				...upper({ module: "seamod", names: ["charnock", "dz0sea", "dz0ice", "drhssea", "drhsice", "albsea", "albice"] }),
				...pair({ name: "dicealbmx", key: "DICEALBMX" }),
				...pair({ name: "dicealbmn", key: "DICEALBMN" }),
			},
		},
		carbon: { ...upper({ module: "carbonmod", names: ["ncarbon", "nsupply", "timeweight", "beta", "kact"] }), PEARTH: scalar("carbonmod.PEARTH"), CO2EARTH: scalar("carbonmod.CO2EARTH"), WMAX: scalar("carbonmod.WMAX"), VEARTH: scalar("carbonmod.VEARTH"), RAD_EARTHSQ: scalar("carbonmod.RAD_EARTHSQ"), PLARAD: scalar("plarad") },
	}
}

// STEPPER.values' calendar, and the step and carbon counter the dump was
// taken at (icemod's and oceanmod's counters equal nstep in every dump).
export function stepCalendar(dump) {
	const scalar = (name) => dump[name][0]
	return {
		step: scalar("nstep"),
		carbonStep: scalar("carbonmod.cstep"),
		calendar: {
			keplerian: scalar("ngenkeplerian") === 1,
			fixedSun: scalar("radmod.nfixed") === 1 ? { longitudeDeg: scalar("fixedlon"), declinationRad: scalar("radmod.obliqr") } : null,
			stepsPerYear: scalar("n_steps_per_year"),
			stepsPerDay: scalar("ntspd"),
			stepMinutes: scalar("mpstep"),
			daysPerYear: scalar("n_days_per_year"),
			daysPerMonth: scalar("n_days_per_month"),
			solarDay: scalar("solar_day"),
			rotationSpeed: scalar("rotspd"),
			toffo3: scalar("radmod.toffo3"),
			orbit: { meanAnomalyRad: scalar("radmod.meananom0r"), eccentricity: scalar("eccen"), obliquityRad: scalar("radmod.obliqr"), perihelionLongitudeRad: scalar("radmod.mvelpp"), meanLongitudeAtEquinoxRad: scalar("radmod.lambm0") },
			carbonInterval: scalar("carbonmod.interval"),
		},
	}
}

// The page's input files for one configuration, by file name: namelist
// text and .sra surface files.
export async function readInputs(directory) {
	const names = (await fs.readdir(directory)).filter((name) => name.endsWith("_namelist") || name.endsWith(".sra"))
	return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await fs.readFile(path.join(directory, name), "utf8")])))
}

// Loads the modules model-inputs needs through Vite's SSR loader.
export async function loadModules(server) {
	const load = (file) => server.ssrLoadModule(path.resolve(file))
	const [{ DYNAMICS }, { DYNAMICS_SETUP }, { GCM_GRID }, { STEPPER }, { CALENDAR }] = await Promise.all(
		["src/model/climate/gcm/dynamics/index.ts", "src/model/climate/gcm/dynamics/setup/index.ts", "src/model/climate/gcm/grid/index.ts", "src/model/climate/gcm/stepper/index.ts", "src/model/climate/gcm/calendar/index.ts"].map(load),
	)
	return { DYNAMICS, DYNAMICS_SETUP, GRID: GCM_GRID, STEPPER, CALENDAR }
}
