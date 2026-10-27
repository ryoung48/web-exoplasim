override XDT: f32;
override XMIND: f32;
override XMAXD: f32;
override CICEMIN: f32;
override TFREEZE: f32;
override TMELT: f32;
override CRHOI: f32;
override CRHOS: f32;
override CRHOSN: f32;
override CPI: f32;
override CKAPI: f32;
override CKAPSN: f32;
override CLFI: f32;
override CLFSN: f32;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// momint's interpolation of a 0–13 climatology: offset 0 in SURFACE_STEP
// for nstep, 3 for nstep + 1.
fn climatology(field: u32, h: u32, offset: u32) -> f32 {
	let weight = state[SURFACE_STEP + offset + 2u];
	let a = state[at(field, u32(state[SURFACE_STEP + offset]), h)];
	let b = state[at(field, u32(state[SURFACE_STEP + offset + 1u]), h)];
	return (1.0 - weight) * a + weight * b;
}

// seastep's coupling (ncpl_atmos_ice = 1, so each step's fluxes pass
// straight through; of the forcing, the slab ocean reads only the heat
// flux) and icestep up to getiflx's global sums: iceget,
// snowfall, skintemp, mkcflux, subsnow, mkice, mkicec (nice = 1, nfluko =
// 0), the xmaxd thickness cap. Fortran runs icestep on every point, land
// included, with zero fluxes there; so does this.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let sea = state[DLS + h] < 0.5;
	var xheat = 0.0;
	var xprs = 0.0;
	if (sea) {
		xheat = state[DSHFL + h] + state[at(DSWFL, NLEV, h)] + state[at(DLWFL, NLEV, h)] + state[DLHFL + h];
		xprs = state[DPRS + h];
	}
	let zrhoilfdt = CRHOI * CLFI / XDT;

	// iceget
	state[XCLSSTO + h] = climatology(XCLSST, h, 0u);
	state[XCLSST2 + h] = climatology(XCLSST, h, 3u);
	let cliced = max(climatology(XCLICED, h, 3u), 0.0);
	var clicec = max(climatology(XCLICEC, h, 3u), 0.0);
	if (cliced <= 0.0) {
		clicec = 0.0;
	}
	state[XCLICED2 + h] = cliced;
	state[XCLICEC2 + h] = clicec;

	let xls = state[XLS + h];
	let xsst = state[XSST + h];
	var xiced = state[XICED + h];
	var xsnow = state[XSNOW + h];
	var xicecc = state[XICECC + h];
	var xcflux = state[XCFLUX + h];
	var xcfluxf = state[XCFLUXF + h];
	state[ICE_SNOWOLD + h] = xsnow;
	let zicedold = select(0.0, xiced, xls < 0.5);
	var ximelt = 0.0;
	var xsmelt = 0.0;
	var xsmflx = 0.0;
	var xscflx = 0.0;
	var xsndch = 0.0;
	var xcfluxr = 0.0;

	// Snowfall on ice.
	if (state[XICEC + h] >= CICEMIN) {
		xsnow = xsnow + xprs * XDT;
		xprs = 0.0;
	}

	// skintemp: surface temperature of ice thicker than xmind from the
	// heat budget of a thin top layer and conduction through ice and snow.
	var xts = state[XTS + h];
	var xqmelt = 0.0;
	let ztso = min(TMELT, xts);
	let zhsnow = 1.0e3 / CRHOSN * xsnow;
	if (xiced >= XMIND) {
		let zcpdt = XMIND * CRHOI * CPI / XDT;
		let zckap = (CKAPSN * zhsnow + CKAPI * xiced) / (zhsnow + xiced);
		var zkapz = zckap / (xiced + zhsnow);
		if (xiced >= XMAXD && XMAXD >= 0.0) {
			zkapz = 0.0;
		}
		let zflx = xheat + zkapz * xsst;
		xts = (zcpdt * ztso + zflx) / (zcpdt + zkapz);
		if (xts > TMELT) {
			xqmelt = xheat + zkapz * (xsst - TMELT) - zcpdt * (TMELT - ztso);
			xts = TMELT;
		}
	} else {
		xts = xsst;
		if (xiced > 0.0) {
			xqmelt = xheat;
		}
	}
	state[XTS + h] = xts;
	state[XQMELT + h] = xqmelt;

	// mkcflux: conductive heat flux through the ice.
	if (xiced < XMIND) {
		xcflux = xheat;
		xcfluxf = 0.0;
	} else {
		let zhsnowc = 1.0e3 / CRHOSN * xsnow;
		var zckap = (CKAPSN * zhsnowc + CKAPI * xiced) / (zhsnowc + xiced);
		if (XMAXD >= 0.0 && xiced >= XMAXD) {
			zckap = 0.0;
		}
		xcflux = zckap * (xts - xsst) / (zhsnowc + xiced);
		xcfluxf = zckap * (TFREEZE - xsst) / (zhsnowc + xiced);
	}

	// subsnow: snow on open water melts, snow on ice melts with xqmelt, and
	// snow heavy enough to push the ice under turns to ice.
	if (state[XICEC + h] < CICEMIN && xprs > 0.0) {
		xcflux = xcflux - xprs * 1000.0 * CLFSN;
		xsmelt = xprs + xsmelt;
		xsmflx = xsmflx + xprs * 1000.0 * CLFSN;
		xprs = 0.0;
	}
	var zqmelt = xqmelt;
	if (xiced > 0.0) {
		if (xqmelt > xsnow * 1000.0 * CLFSN / XDT) {
			xsmelt = xsmelt + xsnow / XDT;
			xsmflx = xsmflx + xsnow * 1000.0 * CLFSN / XDT;
			zqmelt = xqmelt - xsnow * 1000.0 * CLFSN / XDT;
			xsnow = 0.0;
		} else if (xqmelt > 0.0 && xsnow > 0.0) {
			xsmelt = xsmelt + xqmelt / CLFSN / 1000.0;
			xsnow = xsnow - xqmelt * XDT / CLFSN / 1000.0;
			xsmflx = xsmflx + xqmelt;
			zqmelt = 0.0;
		}
		xcflux = xcflux + zqmelt;
	} else {
		xsmelt = xsmelt + xsnow / XDT;
		xcflux = xcflux - xsnow * 1000.0 * CLFSN / XDT;
		xsmflx = xsmflx + xsnow * 1000.0 * CLFSN / XDT;
		xsnow = 0.0;
	}
	if (xls < 0.5 && 1.0e3 * xsnow > (CRHOS - CRHOI) * xiced) {
		let zhice = (1.0e3 * xsnow + CRHOI * xiced) / CRHOS;
		let zdice = zhice - xiced;
		let zdsnow = -zdice * CRHOI / 1.0e3;
		xsnow = xsnow + zdsnow;
		xscflx = zdsnow * 1.0e3 * CLFSN / XDT;
		xsmelt = xsmelt - zdsnow / XDT;
		xsmflx = xsmflx - zdsnow * 1.0e3 * CLFSN / XDT;
	}

	// mkice: the ocean's heat into the ice, then freezing or melting.
	if (xls < 0.5) {
		xcflux = xcflux + state[XOFLUX + h];
	}
	if (xsst <= TFREEZE || xiced > 0.0) {
		ximelt = xcflux + xscflx - xcfluxf;
		xiced = xiced - ximelt / zrhoilfdt;
		xcflux = xcfluxf;
	}
	if (xiced <= 0.0) {
		xcflux = xcflux - xiced * zrhoilfdt;
		ximelt = ximelt + xiced * zrhoilfdt;
		xiced = 0.0;
	}
	if (abs(xiced) < 1.0e-9) {
		xiced = 0.0;
	}

	// mkicec: cover grows with new ice over 0.5 m and shrinks with melt.
	if (xiced > zicedold) {
		xicecc = min(xicecc + (1.0 - xicecc) * (xiced - zicedold) / 0.5, 1.0);
	}
	if (xiced < zicedold) {
		xicecc = max(xicecc + xicecc * (xiced - zicedold) / (2.0 * zicedold), 0.0);
	}
	if (xiced <= 0.0) {
		xicecc = 0.0;
	}

	// Ice thicker than xmaxd melts its excess, and getiflx spreads that
	// heat over the ice below xmaxd.
	if (XMAXD >= 0.0 && xiced > XMAXD) {
		let zcflux = (xiced - XMAXD) * zrhoilfdt;
		xiced = XMAXD;
		xcfluxr = xcfluxr + zcflux;
		ximelt = ximelt + zcflux;
		xsndch = xsndch + zcflux * 1000.0 / CRHOI / zrhoilfdt;
	}
	var zflx = state[ICE_ZFLX + h];
	if (xls < 1.0) {
		zflx = max(0.0, XMAXD - xiced) * zrhoilfdt;
	}
	state[ICE_ZFLX + h] = zflx;
	let xgw = state[XGW + h];
	state[ICE_PART1 + h] = select(0.0, xcfluxr * xgw, xls < 1.0);
	state[ICE_PART2 + h] = select(0.0, zflx * xgw, xls < 1.0);

	state[XICED + h] = xiced;
	state[XSNOW + h] = xsnow;
	state[XICECC + h] = xicecc;
	state[XICEC + h] = xicecc;
	state[XCFLUX + h] = xcflux;
	state[XCFLUXF + h] = xcfluxf;
	state[XCFLUXR + h] = xcfluxr;
	state[XIMELT + h] = ximelt;
	state[XSMELT + h] = xsmelt;
	state[XSMFLX + h] = xsmflx;
	state[XSNDCH + h] = xsndch;
}
