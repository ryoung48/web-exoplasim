import { CALENDAR } from "@/model/climate/gcm/calendar"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import type { GcmPhysicsFilterKind } from "@/model/climate/gcm/legendre/types"
import { GCM_NAMELIST } from "@/model/climate/gcm/namelist"
import type { GcmPumamod } from "@/model/climate/gcm/setup/pumamod/types"
import type { GcmSetupRequest } from "@/model/climate/gcm/setup/types"

// pumamod's parameters (plasimmod.f90 at 5f8dff4).
const PI = 3.14159265359
const TWOPI = PI + PI
// 1 / sqrt(3/8): planetary vorticity in spectral units.
const EZ = 1.63299310207
// Gas constant and specific heat of water vapour.
const RV = 461.51
const ACPV = 1870

// p_earth.f90's planet_ini defaults.
const EARTH = {
	eccen: 0.016715,
	mvelp: 102.7,
	obliq: 23.441,
	rotspd: 1,
	sidereal_day: 86164.0916,
	solar_day: 86400,
	sidereal_year: 31558149,
	tropical_year: 31556956,
	meananom0: -2.9589,
	akap: 0.286,
	alr: 0.0065,
	gascon: 287,
	ra1: 610.78,
	ra2: 17.2693882,
	ra4: 35.86,
	pnu: 0.1,
	ga: 9.80665,
	plarad: 6371220,
	gsol0: 1365,
	nfixorb: 0,
	ngenkeplerian: 0,
}

// plasimmod.f90's namelist defaults for one level count.
function pumamodDefaults(levels: number) {
	return {
		psurf: 101100,
		mpstep: 0,
		ntspd: 0,
		n_days_per_year: 360,
		n_start_year: 1,
		n_start_month: 1,
		nkits: 3,
		kick: 1,
		ndheat: 1,
		nveg: 1,
		nqspec: 1,
		nhdiff: 15,
		nhordif: 1,
		neqsig: 0,
		nfilter: 0,
		ngptfilter: 0,
		nspvfilter: 0,
		filterkappa: 8,
		nfilterexp: 8,
		landhoskn0: 15,
		nwpd: 0,
		nlowio: 0,
		nstpw: 0,
		dtep: 0,
		dtns: 0,
		dtrop: 12000,
		dttrp: 2,
		dttl: 0,
		fixedlon: 0,
		tgr: 288,
		ptop: 7500,
		frcmod: 1,
		ndel: new Array<number>(levels).fill(2),
		tdissd: new Array<number>(levels).fill(0.2),
		tdissz: new Array<number>(levels).fill(1.1),
		tdisst: new Array<number>(levels).fill(5.6),
		tdissq: new Array<number>(levels).fill(0.1),
		restim: new Array<number>(levels).fill(0),
		t0: new Array<number>(levels).fill(250),
		tfrc: new Array<number>(levels).fill(0),
		seed: new Array<number>(8).fill(0),
	}
}

const FILTER_KINDS: GcmPhysicsFilterKind[] = [0, 1, 2, 3, 4]

function filterKind(nfilter: number): GcmPhysicsFilterKind {
	const kind = FILTER_KINDS.find((candidate) => candidate === nfilter)
	if (kind === undefined) throw new Error(`nfilter ${nfilter} is not 0-4`)
	return kind
}

function gaussianLatitudes(truncation: number): number {
	return GCM_GRID.forTruncation(truncation).latitudes
}

// cal2step's simplified calendar: steps from 1 Jan 0000 to the start date.
// planet_ini then readnl (plasim.f90), up to the start of initpm.
function pumamod({
	truncation,
	levels,
	namelists,
}: GcmSetupRequest): GcmPumamod {
	const planet = GCM_NAMELIST.read({
		text: namelists.planet_namelist,
		defaults: EARTH,
	})
	const day24hr = 86400
	const defaults = pumamodDefaults(levels)
	// readnl's resolution defaults, before the namelist.
	if (levels === 10) {
		defaults.tfrc = defaults.tfrc.map(
			(_, l) => (l === 0 ? 20 : l === 1 ? 100 : 0) * day24hr * defaults.frcmod,
		)
	}
	if (truncation === 42) {
		defaults.nhdiff = 16
		defaults.ndel = defaults.ndel.map(() => 4)
		defaults.tdissq = defaults.tdissq.map(() => 0.1 * day24hr)
		defaults.tdisst = defaults.tdisst.map(() => 0.76 * day24hr)
		defaults.tdissz = defaults.tdissz.map(() => 0.3 * day24hr)
		defaults.tdissd = defaults.tdissd.map(() => 0.06 * day24hr)
	}
	const nl = GCM_NAMELIST.read({ text: namelists.plasim_namelist, defaults })

	let solarDay = day24hr
	let siderealDay = (solarDay * (nl.n_days_per_year - 1)) / nl.n_days_per_year
	if (planet.rotspd !== 1) {
		siderealDay = day24hr / planet.rotspd
		solarDay =
			nl.n_days_per_year !== 1
				? (siderealDay * nl.n_days_per_year) / (nl.n_days_per_year - 1)
				: siderealDay
	}
	const mDaysPerYear = Math.round((nl.n_days_per_year * siderealDay) / day24hr)
	const ww = TWOPI / siderealDay
	const acpd = planet.gascon / planet.akap
	const cv = planet.plarad * ww
	let mpstep = nl.mpstep
	if (mpstep <= 0 && nl.ntspd <= 0) {
		const latitudes = gaussianLatitudes(truncation)
		mpstep =
			latitudes <= 32
				? 45
				: latitudes <= 48
					? 36
					: Math.trunc((30 * 64) / latitudes)
	}
	let mtspd = 0
	if (mpstep > 0) {
		mtspd = Math.trunc(Math.round(day24hr) / Math.round(mpstep * 60))
		mtspd = mtspd + (mtspd % 2)
	}
	mpstep = day24hr / (mtspd * 60)
	const ntspd = Math.trunc(Math.round(solarDay) / Math.round(mpstep * 60))
	let nafter = mtspd
	if (nl.nwpd > 0 && nl.nwpd <= mtspd) nafter = Math.trunc(mtspd / nl.nwpd)
	if (nl.nlowio > 0 && nl.nstpw > 0) nafter = nl.nstpw
	const hordif = nl.nhordif !== 0
	const zeroed = (values: number[]) => (hordif ? values : values.map(() => 0))
	return {
		...planet,
		day_24hr: day24hr,
		solar_day: solarDay,
		sidereal_day: siderealDay,
		ww,
		acpd,
		adv: ACPV / acpd - 1,
		cv,
		ct: (cv * cv) / planet.gascon,
		pnu21: 1 - 2 * planet.pnu,
		rdbrv: planet.gascon / RV,
		tmelt: 273.16,
		alv: 2.5008e6,
		als: 2.8345e6,
		dawn: 0,
		psurf: nl.psurf,
		plavor: EZ,
		mpstep,
		mtspd,
		ntspd,
		nafter,
		n_steps_per_year: Math.round(planet.sidereal_year / (mpstep * 60)),
		n_days_per_year: nl.n_days_per_year,
		n_start_year: nl.n_start_year,
		n_start_month: nl.n_start_month,
		n_start_step: CALENDAR.startStep({
			mtspd,
			year: nl.n_start_year,
			month: nl.n_start_month,
			daysPerYear: nl.n_days_per_year,
			daysPerMonth: Math.trunc(mDaysPerYear / 12),
		}),
		n_days_per_month: Math.trunc(mDaysPerYear / 12),
		m_days_per_year: mDaysPerYear,
		nkits: nl.nkits,
		kick: nl.kick,
		ndheat: nl.ndheat,
		nveg: nl.nveg,
		nqspec: nl.nqspec,
		nhdiff: nl.nhdiff,
		nhordif: nl.nhordif,
		neqsig: nl.neqsig,
		nfilter: filterKind(nl.nfilter),
		ngptfilter: nl.ngptfilter,
		nspvfilter: nl.nspvfilter,
		filterkappa: nl.filterkappa,
		nfilterexp: nl.nfilterexp,
		landhoskn0: nl.landhoskn0,
		dtep: nl.dtep,
		dtns: nl.dtns,
		dtrop: nl.dtrop,
		dttrp: nl.dttrp,
		dttl: nl.dttl,
		fixedlon: nl.fixedlon,
		tgr: nl.tgr,
		ptop: nl.ptop,
		ndel: nl.ndel,
		tdissd: zeroed(nl.tdissd),
		tdissz: zeroed(nl.tdissz),
		tdisst: zeroed(nl.tdisst),
		tdissq: zeroed(nl.tdissq),
		restim: zeroed(nl.restim),
		t0: nl.t0,
		tfrc: zeroed(nl.tfrc),
		seed: nl.seed,
	}
}

export const PUMAMOD = {
	TWOPI,
	latitudes: gaussianLatitudes,
	read: pumamod,
}
