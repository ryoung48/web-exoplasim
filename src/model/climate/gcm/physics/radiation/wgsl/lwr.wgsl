override SBK: f32;
override TH2OC: f32;
override TPOFMT: f32;
// Absorptivity offsets lwr computes from its fit coefficients (zao30,
// zco20, zh2o0a, zh2o0, zao3c, zaco2c, zah2oc, zth2oc), in f64.
override ZAO30: f32;
override ZCO20: f32;
override ZH2O0A: f32;
override ZH2O0: f32;
override ZAO3C: f32;
override ZACO2C: f32;
override ZAH2OC: f32;
override ZTH2OC: f32;
// zfco2 * zzf2: CO2 ppmv to a mass path.
override ZFCO2_ZZF2: f32;

const ZERO = 1.0e-6;
const ZFH2O = 0.1;
const ZFO3 = 100.0 / 2.14;
const INV_LN10 = 0.43429448190325176;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

fn log10(x: f32) -> f32 {
	return precise_log(x) * INV_LN10;
}

// radmod's lwr for one column: broadband emissivities of water vapour,
// ozone and CO2 between every pair of levels. Switches fixed for every page
// configuration: npbroaden = 1 (pressure broadening), clgray < 0 (cloud
// emissivity from liquid water). The entropy terms (dftue1, dftue2, dftu0,
// dftd0) are left out: nentropy = 0.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let dp = state[DP + h];
	let ps2 = dp * dp;

	var st4: array<f32, NLEP>;
	for (var l = 0u; l < NLEP; l++) {
		let t = state[at(DT, l, h)];
		let t2 = t * t;
		st4[l] = SBK * (t2 * t2);
	}
	// Blackbody flux at the half levels, interpolated in sigma.
	var st4h: array<f32, NLEP>;
	let sigma0 = tables[TABLE_SIGMA];
	let sigma1 = tables[TABLE_SIGMA + 1u];
	st4h[0] = st4[0] - (st4[0] - st4[1]) * sigma0 / (sigma0 - sigma1);
	for (var l = 1u; l < NLEV; l++) {
		let above = tables[TABLE_SIGMA + l - 1u];
		let half = tables[TABLE_SIGMAH + l - 1u];
		let level = tables[TABLE_SIGMA + l];
		st4h[l] = (st4[l] * (above - half) + st4[l - 1u] * (half - level)) / (above - level);
	}
	let n = NLEV - 1u;
	if ((st4[n] - st4h[n]) * (st4[n] - st4[NLEV]) > 0.0) {
		st4h[NLEV] = st4[NLEV];
	} else {
		let sn = tables[TABLE_SIGMA + n];
		let sm = tables[TABLE_SIGMA + n - 1u];
		st4h[NLEV] = st4[n] + (st4[n] - st4[n - 1u]) * (1.0 - sn) / (sn - sm);
	}

	// zbu and zbd under Fortran's 0..NLEP indices.
	var bu: array<f32, NLEP + 1u>;
	var bd: array<f32, NLEP + 1u>;
	bd[0] = 0.0;
	let dls = state[DLS + h];
	let eps = dls + 0.98 * (1.0 - dls);
	bu[NLEP] = eps * st4[NLEV];

	var q: array<f32, NLEV>;
	var qo3: array<f32, NLEV>;
	var qco2: array<f32, NLEV>;
	var taucc0: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		let sfac = tables[TABLE_LWR_ZZF1 + l] * ps2;
		q[l] = ZFH2O * sfac * state[at(DQ, l, h)];
		qo3[l] = ZFO3 * sfac * state[at(DQO3, l, h)];
		qco2[l] = ZFCO2_ZZF2 * sfac * state[at(DQCO2, l, h)];
		taucc0[l] = 1.0 - state[at(DCC, l, h)]
			* (1.0 - precise_exp(tables[TABLE_LWR_ZZF3 + l] * state[at(DQL, l, h)] * dp));
	}

	var dftu: array<f32, NLEP>;
	var dftd: array<f32, NLEP>;
	for (var l = 0u; l < NLEP; l++) {
		dftu[l] = 0.0;
		dftd[l] = 0.0;
	}
	var taucs: array<f32, NLEV>;
	var tau: array<f32, NLEV>;
	var tausf: array<f32, NLEV>;
	for (var j = 0u; j < NLEV; j++) {
		var taucc = 1.0;
		var sumwv = 0.0;
		var sumo3 = 0.0;
		var sumco2 = 0.0;
		for (var k = j; k < NLEV; k++) {
			sumwv = sumwv + q[k];
			sumo3 = sumo3 + qo3[k];
			sumco2 = sumco2 + qco2[k];
			var ah2o: f32;
			if (sumwv <= 0.01) {
				ah2o = 0.846 * precise_pow(sumwv + 3.59e-5, 0.243) - ZH2O0A;
			} else {
				ah2o = 0.24 * log10(sumwv + 0.01) + ZAH2OC;
			}
			if (TH2OC > 0.0) {
				ah2o = min(ah2o + (1.0 - precise_exp(-TH2OC * sumwv)), 1.0);
			}
			var aco2: f32;
			if (sumco2 <= 1.0) {
				aco2 = 0.0676 * precise_pow(sumco2 + 0.01022, 0.421) - ZCO20;
			} else {
				aco2 = 0.0546 * log10(sumco2) + ZACO2C;
			}
			var th2o: f32;
			if (sumwv <= 2.0) {
				th2o = 1.0 - (0.832 * precise_pow(sumwv + 0.0286, 0.26) - ZH2O0);
			} else {
				th2o = max(0.0, ZTH2OC - 0.1196 * precise_log(sumwv - 0.6931));
			}
			var ao3: f32;
			if (sumo3 <= 0.01) {
				ao3 = 0.209 * precise_pow(sumo3 + 7.0e-5, 0.436) - ZAO30;
			} else {
				ao3 = 0.0212 * log10(sumo3) + ZAO3C;
			}
			let cs = min(1.0 - ZERO, max(ZERO, 1.0 - ah2o - ao3 - aco2 * th2o));
			taucs[k] = cs;
			taucc = taucc * taucc0[k];
			tau[k] = cs * taucc;
		}
		if (j == 0u) {
			// Layer emission: isothermal-gradient form unless the layer's
			// middle is a temperature extremum.
			var tau0 = 1.0 - ZERO;
			for (var k = 0u; k < NLEV; k++) {
				tau0 = taucs[k] / tau0 * taucc0[k] * TPOFMT;
				tau0 = min(1.0 - ZERO, max(ZERO, tau0));
				if ((st4[k] - st4h[k]) * (st4[k] - st4h[k + 1u]) > 0.0) {
					bd[k + 1u] = 0.5 * st4[k] + 0.25 * (st4h[k] + st4h[k + 1u]);
					bu[k + 1u] = bd[k + 1u];
				} else {
					bd[k + 1u] = (st4h[k + 1u] - tau0 * st4h[k]) / (1.0 - tau0)
						- (st4h[k] - st4h[k + 1u]) / precise_log(tau0);
					bu[k + 1u] = st4h[k] + st4h[k + 1u] - bd[k + 1u];
				}
				tau0 = taucs[k];
			}
		}
		dftu[j] = dftu[j] - bu[j + 1u];
		dftd[j] = dftd[j] + bd[j];
		let bdl = bd[j] - bd[j + 1u];
		for (var k = j; k < NLEV; k++) {
			dftu[j] = dftu[j] - (bu[k + 2u] - bu[k + 1u]) * tau[k];
			dftd[k + 1u] = dftd[k + 1u] + bdl * tau[k];
		}
		tausf[j] = tau[NLEV - 1u];
	}
	dftu[NLEV] = dftu[NLEV] - bu[NLEP];
	dftd[NLEV] = dftd[NLEV] + bd[NLEV];
	let reflected = (1.0 - eps) * dftd[NLEV];
	for (var l = 0u; l < NLEV; l++) {
		dftu[l] = dftu[l] - tausf[l] * reflected;
	}
	for (var l = 0u; l < NLEP; l++) {
		state[at(DFTU, l, h)] = dftu[l];
		state[at(DFTD, l, h)] = dftd[l];
		state[at(DLWFL, l, h)] = dftu[l] + dftd[l];
	}
}
