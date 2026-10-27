import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import { SPECTRUM } from "@/model/climate/gcm/physics/radiation/spectrum"
import type {
	GcmAlbedoSetupRequest,
	GcmBandAlbedos,
	GcmModuleSetupRequest,
} from "@/model/climate/gcm/setup/modules/types"

// Each physics module's namelist defaults (ExoPlaSim 5f8dff4) and what its
// *ini routine derives from them. Values keep their Fortran names.

// radmod.f90's radmod_nl defaults; co2 is pumamod's.
const RADMOD = {
	ndcycle: 1,
	no3: 1,
	co2: 360,
	nstartemp: 0,
	starbbtemp: 5772,
	minwavel: 316.036116751,
	nsimplealbedo: 1,
	th2oc: 0.024,
	tswr1: 0.077,
	tswr2: 0.065,
	tswr3: 0.0055,
	tpofmt: 1,
	acllwr: 0.1,
	a0o3: 0.25,
	a1o3: 0.11,
	aco3: 0.08,
	bo3: 20000,
	co3: 5000,
	toffo3: 0.25,
	dawn: 0,
	iyrbp: 0,
}

// radini: the solar constant comes from planet_ini; the tuning for this
// resolution applies only without the diurnal cycle and before the
// namelist; solarini runs for a star temperature.
function radmod({ request, pumamod }: GcmModuleSetupRequest) {
	const defaults = { ...RADMOD, iyrbp: 1950 - pumamod.n_start_year }
	const ntru = request.truncation
	if (
		pumamod.ndheat > 0 &&
		request.levels === 10 &&
		defaults.ndcycle !== 1 &&
		pumamod.neqsig !== 1
	) {
		if (ntru === 21)
			Object.assign(defaults, {
				th2oc: 0.024,
				tswr1: 0.077,
				tswr2: 0.065,
				tswr3: 0.0055,
			})
		if (ntru === 42)
			Object.assign(defaults, {
				tswr1: 0.089,
				tswr2: 0.06,
				tswr3: 0.0048,
				th2oc: 0.0285,
			})
	}
	const values = GCM_NAMELIST.read({
		text: request.namelists.radmod_namelist,
		defaults,
	})
	const spectrum =
		values.nstartemp > 0
			? SPECTRUM.split({
					starTemperatureK: values.starbbtemp,
					minWavelengthM: values.minwavel * 1e-9,
					simpleAlbedo: values.nsimplealbedo > 0.5,
				})
			: null
	const albedos: GcmBandAlbedos = spectrum ?? {
		dsnowalb: [0.6, 0.6],
		dsnowalbmn: [0.4, 0.4],
		dsnowalbmx: [0.8, 0.8],
		dicealbmn: [0.5, 0.5],
		dicealbmx: [0.7, 0.7],
		dglacalbmn: [0.6, 0.6],
		dgroundalb: [0.2, 0.2],
		doceanalb: [0.069, 0.069],
	}
	return {
		...values,
		gsol0: pumamod.gsol0,
		zsolar1: spectrum?.zsolar1 ?? 0.517,
		zsolar2: spectrum?.zsolar2 ?? 0.483,
		zsolars: [spectrum?.zsolar1 ?? 0, spectrum?.zsolar2 ?? 0],
		rcoeff: spectrum?.rcoeff ?? 1,
		albedos,
		// radini's iyrad: Berger's orbit for this year unless the orbit is fixed.
		year: 1950 - values.iyrbp,
	}
}

// rainmod.f90's rainmod_nl defaults and rainini's resolution changes.
function rainmod({ request }: GcmModuleSetupRequest) {
	const defaults = {
		rhbeta: 0,
		nbeta: 3,
		pdeep: 999999,
		pdeepth: 70000,
		rkshallow: 10,
		gamma: request.truncation === 42 && request.levels === 10 ? 0.007 : 0.01,
		clwcrit1: -0.1,
		clwcrit2: 0,
		rcritmod: 1,
		rcritslope: 0,
	}
	const values = GCM_NAMELIST.read({
		text: request.namelists.rainmod_namelist,
		defaults,
	})
	const { clwcrit1, clwcrit2 } = values
	return {
		...values,
		clwfac:
			clwcrit1 > clwcrit2
				? 1 / (clwcrit1 - clwcrit2)
				: clwcrit1 < clwcrit2
					? -1
					: 1,
	}
}

function fluxmod({ request }: GcmModuleSetupRequest) {
	return GCM_NAMELIST.read({
		text: request.namelists.fluxmod_namelist,
		defaults: { zumin: 1, vdiff_lamm: 160, vdiff_b: 5, vdiff_c: 5, vdiff_d: 5 },
	})
}

// landmod.f90's landmod_nl defaults; landini then takes the band albedos of
// snow and glacier from pumamod's (solarini's) and scales the vegetation
// time scales from years to seconds.
function landmod({ request, pumamod, albedos }: GcmAlbedoSetupRequest) {
	const values = GCM_NAMELIST.read({
		text: request.namelists.landmod_namelist,
		defaults: {
			nwetsoil: 0,
			albland: 0.22,
			albsmin: 0.4,
			albsmax: 0.8,
			albsminf: 0.3,
			albsmaxf: 0.4,
			albgmin: 0.6,
			albgmax: 0.8,
			alblandmax: 0.4,
			drhsfull: 0.4,
			dztop: 0.2,
			dsmax: 5,
			wsmax: 0.5,
			rlue: 3.4e-10,
			co2conv: 8.3e-4,
			tau_veg: 10,
			tau_soil: 42,
			rhosnow: 330,
			soildiff: 1.8,
			sicediff: 2.03,
			snowdiff: 0.31,
			soilcap: 2.4e6,
			sicecap: 2.07e6,
			snowcap: 0.6897e6,
			dsoilz: [0.4, 0.8, 1.6, 3.2, 6.4],
			dsnowalbmn: albedos.dsnowalbmn,
			dsnowalbmx: albedos.dsnowalbmx,
			dglacalbmn: albedos.dglacalbmn,
			dgroundalb: albedos.dgroundalb,
		},
	})
	const albsmaxf1 = 0.5 * values.dsnowalbmx[0]
	const albsmaxf2 = 0.5 * values.dsnowalbmx[1]
	return {
		...values,
		wsmax: Math.max(values.wsmax, 0),
		albsmax1: values.dsnowalbmx[0],
		albgmax1: values.dsnowalbmx[0],
		albsmax2: values.dsnowalbmx[1],
		albgmax2: values.dsnowalbmx[1],
		albsmaxf1,
		albsmaxf2,
		albsmin1: values.dsnowalbmn[0],
		albsmin2: values.dsnowalbmn[1],
		albgmin1: values.dglacalbmn[0],
		albgmin2: values.dglacalbmn[1],
		albsminf1: 0.75 * albsmaxf1,
		albsminf2: 0.75 * albsmaxf2,
		tau_veg: values.tau_veg * pumamod.m_days_per_year * pumamod.day_24hr,
		tau_soil: values.tau_soil * pumamod.m_days_per_year * pumamod.day_24hr,
	}
}

function seamod({ request, albedos }: GcmAlbedoSetupRequest) {
	return GCM_NAMELIST.read({
		text: request.namelists.seamod_namelist,
		defaults: {
			albsea: 0.069,
			albice: 0.7,
			dz0sea: 1.5e-5,
			dz0ice: 0.001,
			drhssea: 1,
			drhsice: 1,
			charnock: 0.018,
			doceanalb: albedos.doceanalb,
			dicealbmn: albedos.dicealbmn,
			dicealbmx: albedos.dicealbmx,
		},
	})
}

// icemod.f90's icemod_nl defaults; iceini's timestep is a solar day over
// the steps per day, and no sea ice means a freezing point of 0.
function icemod({ request, pumamod }: GcmModuleSetupRequest) {
	const values = GCM_NAMELIST.read({
		text: request.namelists.icemod_namelist,
		defaults: {
			nseaice: 1,
			xmind: 0.1,
			xmaxd: 9,
			thicec: 0.5,
			tfreeze: 271.25,
			cicemin: 0.5,
		},
	})
	return {
		...values,
		tfreeze: values.nseaice === 0 ? 0 : values.tfreeze,
		xdt: pumamod.solar_day / pumamod.ntspd,
	}
}

function vegmod({ request }: GcmModuleSetupRequest) {
	return GCM_NAMELIST.read({
		text: request.namelists.vegmod_namelist,
		defaults: {
			ncveg: 1,
			forgrow: 1,
			rinidagg: 0.5,
			rinidsc: 1,
			rinidmr: 2,
			rinisoil: 0,
			riniveg: 0,
		},
	})
}

// carbonmod.f90's carbonmod_nl defaults; carbonini's weathering interval
// and yearly-mean weight.
function carbonmod({ request, pumamod }: GcmModuleSetupRequest) {
	const values = GCM_NAMELIST.read({
		text: request.namelists.carbonmod_namelist,
		defaults: {
			ncarbon: 1,
			nsupply: 0,
			kact: 0.09,
			beta: 0.5,
			frequency: 4,
			vearth: 0.05,
			pearth: 79,
			wmax: 1,
		},
	})
	const frequency = Math.min(values.frequency, pumamod.mtspd)
	return {
		...values,
		frequency,
		interval: Math.trunc(pumamod.mtspd / frequency),
		timeweight: 1 / (frequency * pumamod.m_days_per_year),
	}
}

function glaciermod({ request }: GcmModuleSetupRequest) {
	return GCM_NAMELIST.read({
		text: request.namelists.glacier_namelist,
		defaults: { nglacier: 1, glacelim: 2, icesheeth: -1 },
	})
}

export const MODULE_SETUP = {
	radmod,
	rainmod,
	fluxmod,
	landmod,
	seamod,
	icemod,
	vegmod,
	carbonmod,
	glaciermod,
}
