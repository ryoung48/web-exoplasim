// nveg: 1 runs the carbon pools only, 2 also feeds roughness, soil water
// capacity, surface humidity factor, albedo and forest cover back.
override NVEG: i32;
override RLUE: f32;
override CO2CONV: f32;
override TAU_VEG: f32;
override TAU_SOIL: f32;
override VWS_CRIT: f32;
override Q10: f32;
override ZLAIMAX: f32;
override ZLAIMIN: f32;
override VALB_MIN: f32;
override VALB_MAX: f32;
override VSALB_MIN: f32;
override VWMAX_MAX: f32;
override VWMAX_MIN: f32;
override VZ0_MIN: f32;
override CVEG_A: f32;
override CVEG_C: f32;
override CVEG_F: f32;
override CVEG_K: f32;
override CVEG_L: f32;
override CT_CRIT: f32;
override CO2_REF: f32;
override CO2_COMP: f32;
override CO2_SENS: f32;
// atan(cveg_d) and atan(-cveg_f), in f64.
override CVEG_E: f32;
override CVEG_G: f32;
override NCVEG: f32;

// simba's vegstep for one land column below 90% glacier: light- and
// water-limited GPP, vegetation and soil carbon, forest and soil cover.
// rnbiocats = 0; the a* output accumulators and d* diagnostics are not
// ported (noutput = 0).
fn vegstep(h: u32) {
	if (!(state[DLS + h] > 0.0 && state[DGLAC + h] < 0.90)) {
		return;
	}
	let co2 = state[CO2];
	var zbeta = 0.0;
	if (!(co2 < 1.0e-8)) {
		zbeta = max(0.0, 1.0 + CO2_SENS * precise_log((co2 - CO2_COMP) / (CO2_REF - CO2_COMP)));
	}
	let ts = state[at(DT, NLEV, h)];
	let dp = state[DP + h];
	let dwatc = state[DWATC + h];
	let dsnow = state[DSNOW + h];
	var zwmax = state[DWMAX + h];
	let zglacfree = 1.0 - state[DGLAC + h];
	let zsvp = RA1 * precise_exp(RA2 * (ts - TMELT) / (ts - RA4));
	let zvpd = max(0.01, zsvp - dp * state[at(DQ, NLEV - 1u, h)] / 0.622);
	var dcveg = state[DCVEG + h];
	var dcsoil = state[DCSOIL + h];
	let zlaim = ZLAIMIN + 0.63661977236758 * ZLAIMAX * precise_atan(CVEG_L * 2.0 * state[DAGG + h] * dcveg);
	let zvegm = 1.0 - precise_exp(-CVEG_K * zlaim);
	var zveg = 0.0;
	if (zwmax > 0.0) {
		zveg = min(min(1.0, zvegm), max(0.0, dwatc / (zwmax * VWS_CRIT)));
	}
	let zft = min(1.0, max(0.0, (ts - TMELT) / CT_CRIT));
	let zgppl = RLUE * zbeta * zft * zveg * state[at(DFD, NLEV, h)];
	var zgppw = 0.0;
	if (!(co2 < 1.0e-8)) {
		zgppw = CO2CONV * dp * zveg * (-state[DEVAP + h]) / zvpd * (0.3 * co2);
	}
	zgppw = min(1.0, max(0.0, zgppw));
	let zgpp = min(zgppl, zgppw);
	let znpp = state[DGROW + h] * 0.5 * zgpp * zglacfree;
	let zlitter = dcveg / TAU_VEG;
	let zres = precise_pow(Q10, (ts - TMELT - 10.0) / 10.0) * dcsoil / TAU_SOIL;
	dcveg = dcveg + (znpp - zlitter) * DELTSEC * NCVEG;
	dcsoil = dcsoil + (zlitter - zres) * DELTSEC * NCVEG;
	let zforest = min(1.0, max(0.0, (precise_atan(dcveg - CVEG_A) - CVEG_E) / (CVEG_C - CVEG_E)));
	let dvsoil = min(1.0, max(0.0, (precise_atan(dcveg - CVEG_F) - CVEG_G) / (CVEG_C - CVEG_G)));
	state[DCVEG + h] = dcveg;
	state[DCSOIL + h] = dcsoil;
	state[DVSOIL + h] = dvsoil;
	state[DLAI + h] = -precise_log(1.0 - zveg) / CVEG_K;
	let zvz0 = state[DMR + h] * zforest + VZ0_MIN * (1.0 - zforest);
	var zvalb = VALB_MIN * zveg + VALB_MAX * (1.0 - zveg);
	zwmax = VWMAX_MAX * dvsoil + VWMAX_MIN * (1.0 - dvsoil);
	var zvrhs = state[DSC + h] * min(1.0, max(0.0, dwatc / (zwmax * VWS_CRIT)));
	if (dsnow > 0.0) {
		var zalbsn = (ALBSMAX - ALBSMIN) * (ts - 263.16) / (TMELT - 263.16);
		zalbsn = max(ALBSMIN, min(ALBSMAX, ALBSMAX - zalbsn));
		zvalb = zvalb + (zalbsn - zvalb) * dsnow / (dsnow + 0.01);
		zvalb = VSALB_MIN * zforest + zvalb * (1.0 - zforest);
		zvrhs = 1.0;
	}
	if (NVEG == 2) {
		let z0clim = state[DZ0CLIMO + h];
		state[DZ0 + h] = sqrt(zvz0 * zvz0 + z0clim * z0clim);
		state[DWMAX + h] = zwmax;
		state[DRHS + h] = zvrhs;
		state[DALB + h] = zvalb;
		state[DFOREST + h] = zforest;
	}
}
