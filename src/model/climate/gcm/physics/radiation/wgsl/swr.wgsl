override GA: f32;
override GSOL0: f32;
override ZSOLAR1: f32;
override ZSOLAR2: f32;
override ZSOLARS1: f32;
override ZSOLARS2: f32;
override TSWR1: f32;
override TSWR2: f32;
override TSWR3: f32;
// tswr1 sqrt(zmu00) / zmu00, tswr2 sqrt(zmu00) and tswr3 zmu00², the cloud
// coefficients for diffuse light.
override ZB3: f32;
override ZB4: f32;
override ZB5: f32;
override RCOEFF: f32;
// log(1 - 0.144): Rayleigh scattering of diffuse light per unit surface
// pressure.
override LN_DIFFUSE_RAYLEIGH: f32;
// nstartemp = 1: two-band surface albedos from the star's spectrum.
override NSTARTEMP: bool;

const ZERO = 1.0e-6;
const ZBETTA = 1.66;
const ZMBAR = 1.9;
const ZFO3 = 100.0 / 2.14;
// Zenith-angle cosine of diffuse light.
const ZMU00 = 0.5;
const INV_LN10 = 0.43429448190325176;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

fn ozone_absorption(o3: f32) -> f32 {
	return (0.02118 * o3 / (1.0 + 0.042 * o3 + 0.000323 * (o3 * o3))
		+ 1.082 * o3 / precise_pow(1.0 + 138.6 * o3, 0.805)
		+ 0.0658 * o3 / (1.0 + (103.6 * o3) * (103.6 * o3) * (103.6 * o3))) / ZSOLAR1;
}

fn vapour_absorption(wv: f32) -> f32 {
	return 2.9 * wv / (precise_pow(1.0 + 141.5 * wv, 0.635) + 5.925 * wv) / ZSOLAR2;
}

// radmod's swr for one column: two bands (ozone below 0.75 µm, water vapour
// above), each a stack of layers combined by the adding method. Switches
// fixed for every page configuration: nclouds = 1, nswrcl = 1 (cloud optics
// from liquid water), ndcycle = 1, nrscat = 1, newrsc = 0 (Rayleigh
// scattering only at the surface layer), l_aerorad = 0, necham = 1,
// necham6 = 0. Terms these switches multiply by zero are left out.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let mu0 = state[GMU0 + h];
	let gdist2 = state[RADIATION_STEP + 3u];
	let ftop1 = ZSOLAR1 * GSOL0 * gdist2 * mu0;
	let ftop2 = ZSOLAR2 * GSOL0 * gdist2 * mu0;
	if (!(ftop1 + ftop2 > ZERO)) {
		for (var l = 0u; l < NLEP; l++) {
			state[at(DFU, l, h)] = 0.0;
			state[at(DFD, l, h)] = 0.0;
			state[at(DSWFL, l, h)] = 0.0;
		}
		return;
	}
	let dp = state[DP + h];

	var rcl1: array<f32, NLEV>;
	var rcl1s: array<f32, NLEV>;
	var rcl2: array<f32, NLEV>;
	var rcl2s: array<f32, NLEV>;
	var tcl2: array<f32, NLEV>;
	var tcl2s: array<f32, NLEV>;
	var cs = 1.0;
	for (var l = 0u; l < NLEV; l++) {
		let cc = state[at(DCC, l, h)];
		rcl1[l] = 0.0;
		rcl1s[l] = 0.0;
		rcl2[l] = 0.0;
		rcl2s[l] = 0.0;
		tcl2[l] = 1.0;
		tcl2s[l] = 1.0;
		if (cc > 0.0) {
			let lwp = min(1000.0, 1000.0 * state[at(DQL, l, h)] * dp / GA * tables[TABLE_DSIGMA + l]);
			let tau = 2.0 * precise_pow(precise_log(lwp + 1.5) * INV_LN10, 3.9);
			let zlog = precise_log(1000.0 / tau);
			var b2 = ZB4 / precise_log(3.0 + 0.1 * tau);
			var om0 = min(0.9999, 1.0 - ZB5 * zlog);
			var un = 1.0 - om0;
			var uz = un + 2.0 * b2 * om0;
			var u = sqrt(uz / un);
			var ex = precise_exp(min(25.0, tau * sqrt(uz * un) / ZMU00));
			var r = (u + 1.0) * (u + 1.0) * ex - (u - 1.0) * (u - 1.0) / ex;
			rcl1s[l] = 1.0 - 1.0 / (1.0 + ZB3 * tau);
			tcl2s[l] = 4.0 * u / r;
			rcl2s[l] = (u * u - 1.0) / r * (ex - 1.0 / ex);
			let b1 = TSWR1 * sqrt(mu0);
			b2 = TSWR2 * sqrt(mu0) / precise_log(3.0 + 0.1 * tau);
			om0 = min(0.9999, 1.0 - TSWR3 * mu0 * mu0 * zlog);
			un = 1.0 - om0;
			uz = un + 2.0 * b2 * om0;
			u = sqrt(uz / un);
			ex = precise_exp(min(25.0, tau * sqrt(uz * un) / mu0));
			r = (u + 1.0) * (u + 1.0) * ex - (u - 1.0) * (u - 1.0) / ex;
			let direct1 = 1.0 - 1.0 / (1.0 + b1 * tau / mu0);
			let directT = 4.0 * u / r;
			let direct2 = (u * u - 1.0) / r * (ex - 1.0 / ex);
			rcl1[l] = cs * direct1 + (1.0 - cs) * rcl1s[l];
			tcl2[l] = cs * directT + (1.0 - cs) * tcl2s[l];
			rcl2[l] = cs * direct2 + (1.0 - cs) * rcl2s[l];
		}
		cs = cs * (1.0 - cc);
	}

	// Ozone and water-vapour paths from the top, with slant (zm) paths
	// above the first cloud and diffuse (zmbar, zbetta) ones below.
	let zm = 35.0 / sqrt(1.0 + 1224.0 * mu0 * mu0);
	var o3l: array<f32, NLEV>;
	var xo3l: array<f32, NLEV>;
	var wvl: array<f32, NLEV>;
	var ywvl: array<f32, NLEV>;
	var o3t = 0.0;
	var xo3t = 0.0;
	var wvt = 0.0;
	var ywvt = 0.0;
	cs = 1.0;
	for (var l = 0u; l < NLEV; l++) {
		let dsigma = tables[TABLE_DSIGMA + l];
		let o3 = ZFO3 * dsigma * dp * state[at(DQO3, l, h)] / GA;
		o3t = o3t + o3;
		xo3t = cs * (xo3t + zm * o3) + (1.0 - cs) * (xo3t + ZMBAR * o3);
		o3l[l] = o3t;
		xo3l[l] = xo3t;
		let wv = 0.1 * dsigma * state[at(DQ, l, h)] * dp / GA
			* sqrt(273.0 / state[at(DT, l, h)]) * tables[TABLE_SIGMA + l] * dp / 100000.0;
		wvt = wvt + wv;
		ywvt = cs * (ywvt + zm * wv) + (1.0 - cs) * (ywvt + ZBETTA * wv);
		wvl[l] = wvt;
		ywvl[l] = ywvt;
		cs = cs * (1.0 - state[at(DCC, l, h)]);
	}

	var ta1 = 1.0;
	var ta1s = 1.0;
	var ra1 = 0.0;
	var ra1s = 0.0;
	var ta2 = 1.0;
	var ta2s = 1.0;
	var ra2 = 0.0;
	var ra2s = 0.0;
	var to3t = 1.0;
	var to3tu = 1.0 - ozone_absorption(xo3t + ZMBAR * o3t);
	var twvt = 1.0;
	var twvtu = 1.0 - vapour_absorption(ywvt + ZBETTA * wvt);
	// Rayleigh scattering of the lowest layer, for direct light under clear
	// sky and diffuse light under clouds.
	let ccn = state[at(DCC, NLEV - 1u, h)];
	let scf = RCOEFF * dp / 101100.0 * 9.80665 / GA;
	let diffuseRayleigh = 1.0 - precise_exp(scf * LN_DIFFUSE_RAYLEIGH);
	let rcsuSurface = diffuseRayleigh * (1.0 - ccn);
	let rcsSurface = (1.0 - precise_exp(scf * precise_log(1.0 - 0.219 / (1.0 + 0.816 * mu0)))) * cs
		+ diffuseRayleigh * (1.0 - cs - ccn);

	var t1: array<f32, NLEP>;
	var t2: array<f32, NLEP>;
	var r1s: array<f32, NLEP>;
	var r2s: array<f32, NLEP>;
	var tb1: array<f32, NLEV>;
	var tb1u: array<f32, NLEV>;
	var rb1: array<f32, NLEV>;
	var rb1s: array<f32, NLEV>;
	var tb2: array<f32, NLEV>;
	var tb2u: array<f32, NLEV>;
	var rb2: array<f32, NLEV>;
	var rb2s: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		let cc = state[at(DCC, l, h)];
		t1[l] = ta1;
		t2[l] = ta2;
		r1s[l] = ra1s;
		r2s[l] = ra2s;
		let surface = l == NLEV - 1u;
		rb1[l] = select(0.0, rcsSurface, surface) + rcl1[l] * cc;
		rb1s[l] = select(0.0, rcsuSurface, surface) + rcl1s[l] * cc;
		var o3 = xo3l[l];
		let to3 = (1.0 - ozone_absorption(o3)) / to3t;
		to3t = to3t * to3;
		o3 = xo3t + ZMBAR * (o3t - o3l[l]);
		let to3u = to3tu / (1.0 - ozone_absorption(o3));
		to3tu = to3tu / to3u;
		tb1[l] = 1.0 - (1.0 - to3) * (1.0 - cc) - rb1[l];
		tb1u[l] = 1.0 - (1.0 - to3u) * (1.0 - cc) - rb1s[l];
		let m1 = 1.0 / (1.0 - ra1s * rb1s[l]);
		ra1 = ra1 + ta1 * rb1[l] * ta1s * m1;
		ta1 = ta1 * tb1[l] * m1;
		ra1s = rb1s[l] + tb1u[l] * ra1s * tb1[l] * m1;
		ta1s = tb1u[l] * ta1s * m1;

		rb2[l] = rcl2[l] * cc;
		rb2s[l] = rcl2s[l] * cc;
		var wv = ywvl[l];
		let twv = (1.0 - vapour_absorption(wv)) / twvt;
		twvt = twvt * twv;
		wv = ywvt + ZBETTA * (wvt - wvl[l]);
		let twvu = twvtu / (1.0 - vapour_absorption(wv));
		twvtu = twvtu / twvu;
		tb2[l] = 1.0 - (1.0 - twv) * (1.0 - cc) - (1.0 - tcl2[l]) * cc;
		tb2u[l] = 1.0 - (1.0 - twvu) * (1.0 - cc) - (1.0 - tcl2s[l]) * cc;
		let m2 = 1.0 / (1.0 - ra2s * rb2s[l]);
		ra2 = ra2 + ta2 * rb2[l] * ta2s * m2;
		ta2 = ta2 * tb2[l] * m2;
		ra2s = rb2s[l] + tb2u[l] * ra2s * tb2[l] * m2;
		ta2s = tb2u[l] * ta2s * m2;
	}
	t1[NLEV] = ta1;
	t2[NLEV] = ta2;
	r1s[NLEV] = ra1s;
	r2s[NLEV] = ra2s;

	// Surface albedo: land and sea ice keep theirs, open water gets a
	// zenith-angle dependent one.
	let dalb = state[DALB + h];
	let salb1 = state[DSALB + h];
	let salb2 = state[DSALB + NHOR + h];
	ra1s = select(dalb, salb1, NSTARTEMP);
	ra2s = select(dalb, salb2, NSTARTEMP);
	let dls = state[DLS + h];
	let dicec = state[DICEC + h];
	let water = (1.0 - dls) * (1.0 - dicec) * min(0.05 / (mu0 + 0.15), 0.15);
	let nalb1 = dls * salb1 + (1.0 - dls) * dicec * salb1 + water;
	let nalb2 = dls * salb2 + (1.0 - dls) * dicec * salb2 + water;
	state[DSALB + h] = nalb1;
	state[DSALB + NHOR + h] = nalb2;
	var albedo: f32;
	if (NSTARTEMP) {
		albedo = ZSOLARS1 * nalb1 + ZSOLARS2 * nalb2;
	} else {
		albedo = dls * dalb + (1.0 - dls) * dicec * dalb + water;
	}
	state[DALB + h] = albedo;
	ra1 = select(albedo, nalb1, NSTARTEMP);
	ra2 = select(albedo, nalb2, NSTARTEMP);

	var rl1: array<f32, NLEP>;
	var rl2: array<f32, NLEP>;
	var rl1s: array<f32, NLEP>;
	var rl2s: array<f32, NLEP>;
	for (var l = i32(NLEV) - 1; l >= 0; l--) {
		rl1[l + 1] = ra1;
		rl2[l + 1] = ra2;
		rl1s[l + 1] = ra1s;
		rl2s[l + 1] = ra2s;
		let d1 = 1.0 - ra1s * rb1s[l];
		ra1 = rb1[l] + tb1[l] * ra1 * tb1u[l] / d1;
		ra1s = rb1s[l] + tb1u[l] * ra1s * tb1u[l] / d1;
		let d2 = 1.0 - ra2s * rb2s[l];
		ra2 = rb2[l] + tb2[l] * ra2 * tb2u[l] / d2;
		ra2s = rb2s[l] + tb2u[l] * ra2s * tb2u[l] / d2;
	}
	rl1[0] = ra1;
	rl2[0] = ra2;
	rl1s[0] = ra1s;
	rl2s[0] = ra2s;

	for (var l = 0u; l < NLEP; l++) {
		let m1 = 1.0 / (1.0 - r1s[l] * rl1s[l]);
		let m2 = 1.0 / (1.0 - r2s[l] * rl2s[l]);
		let fu = -t1[l] * rl1[l] * m1 * ftop1 + -t2[l] * rl2[l] * m2 * ftop2;
		let fd = t1[l] * m1 * ftop1 + t2[l] * m2 * ftop2;
		state[at(DFU, l, h)] = fu;
		state[at(DFD, l, h)] = fd;
		state[at(DSWFL, l, h)] = fu + fd;
	}
}
