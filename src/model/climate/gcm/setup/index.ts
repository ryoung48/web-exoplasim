import { CALENDAR } from "@/model/climate/gcm/calendar"
import { DYNAMICS_SETUP } from "@/model/climate/gcm/dynamics/setup"
import type { GcmDynamicsSetup } from "@/model/climate/gcm/dynamics/setup/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { MODULE_SETUP } from "@/model/climate/gcm/setup/modules"
import { PUMAMOD } from "@/model/climate/gcm/setup/pumamod"
import { INITIAL_STATE } from "@/model/climate/gcm/setup/state"
import { SURFACE_SETUP } from "@/model/climate/gcm/setup/surface"
import type {
	GcmDynamicsTablesSetup,
	GcmInitialState,
	GcmSetup,
	GcmSetupConstantsRequest,
	GcmSetupRequest,
	GcmSetupStateRequest,
	GcmTimestepRequest,
	GcmTimesteps,
} from "@/model/climate/gcm/setup/types"

// radmod's Stefan–Boltzmann constant, and icemod's and oceanmod's water,
// ice and snow parameters (all Fortran parameters).
const SBK = 5.67e-8
const ICE = {
	TMELT: 273.16,
	CRHOI: 920,
	CRHOS: 1030,
	CRHOSN: 330,
	CPI: 2070,
	CKAPI: 2.03,
	CKAPSN: 0.31,
	CLFI: 3.28e5,
	CLFSN: 3.337e5,
}
const CPS = 4180
// carbonmod's Earth references: CO2 (ppmv) and radius² (m²).
const CO2EARTH = 330
const RAD_EARTHSQ = 6371220 * 6371220

// master's timestep in seconds and as a fraction of a rotation, halved for
// each start-up step still to run (kits; 0 in the main loop).
function timesteps({ pumamod, kits }: GcmTimestepRequest): GcmTimesteps {
	return {
		deltsec: pumamod.day_24hr / pumamod.mtspd / 2 ** kits,
		delt: PUMAMOD.TWOPI / pumamod.ntspd / 2 ** kits,
	}
}

// prolog's set-up from the page's namelist text: pumamod, each physics
// module's *ini, and master's timestep for the main loop or a start-up
// step. Start-up steps skip the leapfrog filter and icestep.
function constants(request: GcmSetupConstantsRequest): GcmSetup {
	const namelist = PUMAMOD.read(request)
	// prolog: psurf is the sea-level pressure until the orography lowers it.
	const meanHeight =
		(request.meanOrography * namelist.cv * namelist.cv) / Math.SQRT2
	const pumamod = {
		...namelist,
		psurf: Math.exp(
			Math.log(namelist.psurf) - meanHeight / namelist.gascon / namelist.tgr,
		),
	}
	const module = { request, pumamod }
	const rad = MODULE_SETUP.radmod(module)
	const rain = MODULE_SETUP.rainmod(module)
	const flux = MODULE_SETUP.fluxmod(module)
	const land = MODULE_SETUP.landmod({ ...module, albedos: rad.albedos })
	const sea = MODULE_SETUP.seamod({ ...module, albedos: rad.albedos })
	const ice = MODULE_SETUP.icemod(module)
	const veg = MODULE_SETUP.vegmod(module)
	const carbon = MODULE_SETUP.carbonmod(module)
	const glacier = MODULE_SETUP.glaciermod(module)
	const {
		ga,
		gascon,
		acpd,
		adv,
		rdbrv,
		ra1,
		ra2,
		ra4,
		tmelt,
		alv,
		als,
		psurf,
	} = pumamod
	const { deltsec, delt } = timesteps({ pumamod, kits: request.kits })
	const deltsec2 = deltsec + deltsec
	const delt2 = delt + delt
	const coupled = request.kits === 0
	const dtmix = pumamod.solar_day / pumamod.ntspd
	return {
		pumamod,
		co2: rad.co2,
		stepper: {
			dynamics: {
				psurf,
				ww: pumamod.ww,
				cv: pumamod.cv,
				ct: pumamod.ct,
				akap: pumamod.akap,
				rdbrv,
				adv,
				acpd,
				ga,
				plavor: pumamod.plavor,
				delt,
				delt2,
				deltsec2,
				pnu: pumamod.pnu,
				pnu21: pumamod.pnu21,
				filter: coupled,
			},
			fixer: { delt2, psurf },
			surfaceFlux: {
				rdbrv,
				gascon,
				ga,
				acpd,
				adv,
				deltsec,
				deltsec2,
				ra2,
				ra4,
				tmelt,
				alv,
				als,
				zumin: flux.zumin,
				vdiffB: flux.vdiff_b,
				vdiffC: flux.vdiff_c,
				vdiffD: flux.vdiff_d,
				ndheat: pumamod.ndheat > 0,
			},
			radiation: {
				ga,
				gascon,
				acpd,
				adv,
				gsol0: rad.gsol0,
				zsolar1: rad.zsolar1,
				zsolar2: rad.zsolar2,
				zsolars1: rad.zsolars[0],
				zsolars2: rad.zsolars[1],
				tswr1: rad.tswr1,
				tswr2: rad.tswr2,
				tswr3: rad.tswr3,
				rcoeff: rad.rcoeff,
				nstartemp: rad.nstartemp > 0,
				ozone: rad.no3 === 1,
				a0o3: rad.a0o3,
				a1o3: rad.a1o3,
				aco3: rad.aco3,
				bo3: rad.bo3,
				co3: rad.co3,
				dawnDeg: rad.dawn,
				sbk: SBK,
				th2oc: rad.th2oc,
				tpofmt: rad.tpofmt,
			},
			precipitation: {
				deltsec2,
				psurf,
				ww: pumamod.ww,
				ga,
				gascon,
				acpd,
				adv,
				alv,
				als,
				rdbrv,
				ra1,
				ra2,
				ra4,
				tmelt,
				rhbeta: rain.rhbeta,
				nbeta: rain.nbeta,
				pdeep: rain.pdeep,
				pdeepth: rain.pdeepth,
				rkshallow: rain.rkshallow,
				gamma: rain.gamma,
				solarDay: pumamod.solar_day,
				clwfac: rain.clwfac,
				clwcrit1: rain.clwcrit1,
				clwcrit2: rain.clwcrit2,
			},
			surface: {
				soil: {
					DELTSEC: deltsec,
					TMELT: tmelt,
					ALS: als,
					ALV: alv,
					SICECAP: land.sicecap,
					SOILCAP: land.soilcap,
					SICEDIFF: land.sicediff,
					SOILDIFF: land.soildiff,
					SNOWCAP: land.snowcap,
					SNOWDIFF: land.snowdiff,
					RHOSNOW: land.rhosnow,
					DZTOP: land.dztop,
					DSMAX: land.dsmax,
				},
				land: {
					DELTSEC: deltsec,
					TMELT: tmelt,
					RDBRV: rdbrv,
					RA1: ra1,
					RA2: ra2,
					RA4: ra4,
					ALBSMAX: land.albsmax,
					ALBSMIN: land.albsmin,
					ALBSMAXF: land.albsmaxf,
					ALBSMINF: land.albsminf,
					ALBSMAX1: land.albsmax1,
					ALBSMIN1: land.albsmin1,
					ALBSMAXF1: land.albsmaxf1,
					ALBSMINF1: land.albsminf1,
					ALBSMAX2: land.albsmax2,
					ALBSMIN2: land.albsmin2,
					ALBSMAXF2: land.albsmaxf2,
					ALBSMINF2: land.albsminf2,
					ALBGMAX: land.albgmax,
					ALBGMIN: land.albgmin,
					ALBGMAX1: land.albgmax1,
					ALBGMIN1: land.albgmin1,
					ALBGMAX2: land.albgmax2,
					ALBGMIN2: land.albgmin2,
					DRHSFULL: land.drhsfull,
					NWETSOIL: land.nwetsoil,
					WSMAX: land.wsmax,
					ALBLAND: land.albland,
					ALBLANDMAX: land.alblandmax,
					DGROUNDALB1: land.dgroundalb[0],
					DGROUNDALB2: land.dgroundalb[1],
					DOCEANALB1: sea.doceanalb[0],
					DOCEANALB2: sea.doceanalb[1],
				},
				vegetation: {
					NVEG: pumamod.nveg,
					RLUE: land.rlue,
					CO2CONV: land.co2conv,
					TAU_VEG: land.tau_veg,
					TAU_SOIL: land.tau_soil,
					VWS_CRIT: 0.25,
					Q10: 2,
					ZLAIMAX: 9,
					ZLAIMIN: 0.1,
					VALB_MIN: 0.12,
					VALB_MAX: 0.3,
					VSALB_MIN: 0.2,
					VWMAX_MAX: 0.5,
					VWMAX_MIN: 0.05,
					VZ0_MIN: 0.05,
					CVEG_A: 2.9,
					CVEG_C: 1.570796326794897,
					CVEG_D: -1.9,
					CVEG_F: 3,
					CVEG_K: 0.5,
					CVEG_L: 0.25,
					CT_CRIT: 5,
					CO2_REF: 360,
					CO2_COMP: 0,
					CO2_SENS: 0.3,
					NCVEG: veg.ncveg,
				},
				nglacier: glacier.nglacier > 0,
				ice: {
					XDT: ice.xdt,
					XMIND: ice.xmind,
					XMAXD: ice.xmaxd,
					CICEMIN: ice.cicemin,
					THICEC: ice.thicec,
					TFREEZE: ice.tfreeze,
					...ICE,
				},
				ocean: { DTMIX: dtmix, CPS },
				sea: {
					RDBRV: rdbrv,
					RA1: ra1,
					RA2: ra2,
					RA4: ra4,
					GASCON: gascon,
					GA: ga,
					CHARNOCK: sea.charnock,
					DZ0SEA: sea.dz0sea,
					DZ0ICE: sea.dz0ice,
					DRHSSEA: sea.drhssea,
					DRHSICE: sea.drhsice,
					ALBSEA: sea.albsea,
					ALBICE: sea.albice,
					DICEALBMX1: sea.dicealbmx[0],
					DICEALBMX2: sea.dicealbmx[1],
					DICEALBMN1: sea.dicealbmn[0],
					DICEALBMN2: sea.dicealbmn[1],
				},
				seaCoupled: coupled,
			},
			carbon: {
				NCARBON: carbon.ncarbon,
				NSUPPLY: carbon.nsupply,
				TIMEWEIGHT: carbon.timeweight,
				CO2EARTH,
				BETA: carbon.beta,
				KACT: carbon.kact,
				PEARTH: carbon.pearth,
				WMAX: carbon.wmax,
				VEARTH: carbon.vearth,
				PLARAD: pumamod.plarad,
				RAD_EARTHSQ,
			},
		},
		calendar: {
			stepsPerYear: pumamod.n_steps_per_year,
			stepsPerDay: pumamod.ntspd,
			stepMinutes: pumamod.mpstep,
			daysPerYear: pumamod.n_days_per_year,
			daysPerMonth: pumamod.n_days_per_month,
			solarDay: pumamod.solar_day,
			rotationSpeed: pumamod.rotspd,
			toffo3: rad.toffo3,
			orbit: CALENDAR.orbit({
				fixed: pumamod.nfixorb === 1,
				eccentricity: pumamod.eccen,
				obliquityDeg: pumamod.obliq,
				perihelionDeg: pumamod.mvelp,
				meanAnomalyDeg: pumamod.meananom0,
				year: rad.year,
			}),
			carbonInterval: carbon.interval,
		},
		tables: {
			filters: {
				truncation: request.truncation,
				nfilter: pumamod.nfilter,
				ngptfilter: pumamod.ngptfilter,
				nspvfilter: pumamod.nspvfilter,
				filterkappa: pumamod.filterkappa,
				nfilterexp: pumamod.nfilterexp,
				landhoskn0: pumamod.landhoskn0,
			},
			akap: pumamod.akap,
			gascon,
			ga,
			vdiffLamm: flux.vdiff_lamm,
			vdiffD: flux.vdiff_d,
			acllwr: rad.acllwr,
			rcritmod: rain.rcritmod,
			rcritslope: rain.rcritslope,
			dsoilz: land.dsoilz,
		},
	}
}

// initpm's input from pumamod after readnl.
function dynamics(request: GcmSetupRequest): GcmDynamicsSetup {
	const pumamod = PUMAMOD.read(request)
	return DYNAMICS_SETUP.initpm({
		truncation: request.truncation,
		levels: request.levels,
		neqsig: pumamod.neqsig,
		restim: pumamod.restim,
		tfrc: pumamod.tfrc,
		tdissd: pumamod.tdissd,
		tdissz: pumamod.tdissz,
		tdisst: pumamod.tdisst,
		tdissq: pumamod.tdissq,
		ndel: pumamod.ndel,
		nhdiff: pumamod.nhdiff,
		dayLengthS: pumamod.day_24hr,
		stepsPerDay: pumamod.mtspd,
		t0: pumamod.t0,
		dtns: pumamod.dtns,
		dtep: pumamod.dtep,
		dttrp: pumamod.dttrp,
		ct: pumamod.ct,
		akap: pumamod.akap,
	})
}

// DYNAMICS.TABLES for a step: initpm's and initsi's, makebm's bm1 for its
// timestep, and the state's orography and restoration fields.
function dynamicsTables({
	request,
	kits,
	state: initial,
}: GcmDynamicsTablesSetup): Record<string, Float64Array> {
	const setup = dynamics(request)
	const { delt } = timesteps({ pumamod: PUMAMOD.read(request), kits })
	const grid = GCM_GRID.forLatitudes(PUMAMOD.latitudes(request.truncation))
	const tables = DYNAMICS_SETUP.tables({
		setup,
		bm1: DYNAMICS_SETUP.makebm({ setup, truncation: request.truncation, delt }),
		rcsq: DYNAMICS_SETUP.latitudeFactors({ grid }),
	})
	return {
		...Object.fromEntries(
			Object.entries(tables).map(([name, values]) => [
				name,
				Float64Array.from(values),
			]),
		),
		sop: initial.so,
		srp: initial.fields.sr,
	}
}

// prolog's fresh-start state: initfd's spectral fields and setzt's
// restoration field, then surfini's surface and orography. With nspinit,
// ln(ps) starts from the orography instead of the noise.
function state(request: GcmSetupStateRequest): GcmInitialState {
	const pumamod = PUMAMOD.read(request)
	const spectral = INITIAL_STATE.spectral({
		pumamod,
		dynamics: dynamics(request),
		truncation: request.truncation,
		clock: request.clock,
	})
	const surface = SURFACE_SETUP.initial({ request, pumamod })
	if (MODULE_SETUP.surfmod({ request, pumamod }).nspinit > 0) {
		const scale = (pumamod.cv * pumamod.cv) / (pumamod.gascon * pumamod.tgr)
		spectral.sp = surface.so.map((value) => -value * scale)
		spectral.spm = spectral.sp.slice()
	}
	return { fields: { ...spectral, ...surface.fields }, so: surface.so }
}

export const SETUP = {
	pumamod: PUMAMOD.read,
	constants,
	dynamics,
	dynamicsTables,
	state,
}
