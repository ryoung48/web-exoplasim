// The page's model inputs, as the Fortran reads them: each namelist file's
// text by file name (plasim_namelist, planet_namelist, …).
export interface GcmSetupRequest {
	truncation: number
	levels: number
	namelists: Record<string, string>
}

// pumamod's values when initpm starts: planet_ini's planet, then readnl's
// namelist and the quantities it derives. Keys are the Fortran names, so
// the record maps one to one onto the namelists and the probe dumps.
export interface GcmPumamod {
	ga: number
	gascon: number
	akap: number
	alr: number
	ra1: number
	ra2: number
	ra4: number
	pnu: number
	plarad: number
	rotspd: number
	gsol0: number
	eccen: number
	mvelp: number
	obliq: number
	meananom0: number
	nfixorb: number
	ngenkeplerian: number
	day_24hr: number
	solar_day: number
	sidereal_day: number
	sidereal_year: number
	tropical_year: number
	ww: number
	acpd: number
	adv: number
	cv: number
	ct: number
	pnu21: number
	rdbrv: number
	tmelt: number
	alv: number
	als: number
	dawn: number
	psurf: number
	plavor: number
	mpstep: number
	mtspd: number
	ntspd: number
	nafter: number
	n_steps_per_year: number
	n_days_per_year: number
	n_days_per_month: number
	m_days_per_year: number
	nkits: number
	kick: number
	ndheat: number
	nveg: number
	nqspec: number
	nhdiff: number
	nhordif: number
	neqsig: number
	nfilter: number
	ngptfilter: number
	nspvfilter: number
	filterkappa: number
	nfilterexp: number
	landhoskn0: number
	dtep: number
	dtns: number
	dtrop: number
	dttrp: number
	tgr: number
	ptop: number
	ndel: number[]
	tdissd: number[]
	tdissz: number[]
	tdisst: number[]
	tdissq: number[]
	restim: number[]
	t0: number[]
	tfrc: number[]
	seed: number[]
}

// A namelist value (as written) over a default of the same shape.
export interface GcmNamelistOverride<T> {
	value: string | undefined
	fallback: T
}
