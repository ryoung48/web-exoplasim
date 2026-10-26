// solar_day · 1000: dprc (m/s) to mm/day.
override ZRFAC: f32;
override CLWFAC: f32;
override CLWCRIT1: f32;
override CLWCRIT2: f32;

const ZCLMAX = 1.0;
const ZCCA = 0.245;
const ZCCB = 0.125;
const ZCCMAX = 0.8;
const ZCCMIN = 0.05;

// rainmod's mkclouds: convective cover from the convective rain rate,
// stratiform cover from relative humidity above rcrit, liquid water from
// an exponential profile scaled by the column's water vapour, and total
// cover (level NLEP) by random overlap.
fn mkclouds(h: u32) {
	let dp = state[DP + h];
	var zcctot = ZCCMIN;
	var zccconv = ZCCMIN;
	let dprc = state[DPRC + h];
	if (dprc > 0.0) {
		zcctot = ZCCA + ZCCB * precise_log(dprc * ZRFAC);
		zcctot = min(ZCCMAX, max(ZCCMIN, zcctot));
		let levels = state[ICCTOT + h];
		zccconv = select(1.0 - precise_pow(1.0 - zcctot, 1.0 / levels), 1.0, levels == 0.0);
	}
	var cover: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		let zt = state[at(DT, l, h)] + state[at(DTDT, l, h)] * DELTSEC2;
		let zq = state[at(DQ, l, h)] + state[at(DQDT, l, h)] * DELTSEC2;
		let zqsat = saturation_divided(zt, dp * tables[TABLE_SIGMA + l]);
		var zrh = zq / zqsat;
		let icclev = state[at(ICCLEV, l, h)];
		var dcc = 0.0;
		if (icclev > 0.0) {
			dcc = zccconv;
		}
		if (icclev == 2.0 && zcctot >= 0.3) {
			dcc = min(dcc + 2.0 * (zcctot - 0.3), ZCLMAX);
		}
		zrh = zrh * (1.0 - dcc);
		let zrcrit = tables[TABLE_RCRIT + l];
		var zwfac = 1.0;
		if (tables[TABLE_SIGMA + l] > 0.8 && CLWFAC > 0.0) {
			let dw = state[at(DW, l, h)];
			zwfac = CLWFAC * max(0.0, CLWCRIT1 - dw);
			if (CLWCRIT2 > dw) {
				zwfac = 1.0;
			}
		}
		let excess = max(0.0, (zrh - zrcrit) / (1.0 - zrcrit));
		cover[l] = min(dcc + zwfac * (excess * excess), ZCLMAX);
	}

	// Heights of full levels from the hypsometric equation, and the
	// column's water vapour (kg/m²).
	var zzf: array<f32, NLEV>;
	var dqvi = 0.0;
	var zzh = 0.0;
	for (var l = NLEV - 1u; l >= 1u; l--) {
		dqvi = state[at(DQ, l, h)] * tables[TABLE_DSIGMA + l] + dqvi;
		let zdh = -state[at(DT, l, h)] * GASCON / GA * tables[TABLE_RAD_LNSIG + l];
		zzf[l] = zzh + zdh * 0.5;
		zzh = zzh + zdh;
	}
	dqvi = state[at(DQ, 0u, h)] * tables[TABLE_DSIGMA] + dqvi;
	zzf[0] = zzh - state[at(DT, 0u, h)] * GASCON / GA * tables[TABLE_RAD_LNSIG];
	dqvi = dqvi * dp / GA;
	state[DQVI + h] = dqvi;
	zzh = 700.0 * precise_log(1.0 + dqvi);
	var clear = 1.0;
	for (var l = 0u; l < NLEV; l++) {
		var dql = 0.0;
		if (zzh > 0.0 && cover[l] > 0.0) {
			dql = 0.00021 * precise_exp(-zzf[l] / zzh) * GASCON * state[at(DT, l, h)]
				/ (tables[TABLE_SIGMA + l] * dp);
			dql = max(dql, 1.0e-9);
		}
		state[at(DQL, l, h)] = dql;
		state[at(DCC, l, h)] = cover[l];
		clear = clear * (1.0 - cover[l]);
	}
	state[at(DQL, NLEV, h)] = 0.0;
	state[at(DCC, NLEV, h)] = 1.0 - clear;
}
