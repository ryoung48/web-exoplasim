override DELT: f32;
override DELT2: f32;
override PNU: f32;
override PNU21: f32;
// nkits == 0: the leapfrog filter runs only after the start-up steps.
override FILTER: bool;

fn level(field: u32, l: u32, s: u32) -> u32 {
	return field + l * NRSP + s;
}

// spectrala for one real spectral coefficient s (Hoskins and Simmons 1975
// semi-implicit scheme, as in plasim.f90). g, tau and bm1 are column-major
// Fortran arrays: g(k, l) at l * NLEV + k.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let s = id.x;
	if (s >= THREADS) {
		return;
	}
	let apm = state[SPM + s];
	var adm: array<f32, NLEV>;
	var azm: array<f32, NLEV>;
	var atm: array<f32, NLEV>;
	var aqm: array<f32, NLEV>;
	var adt: array<f32, NLEV>;
	var stt: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		adm[l] = state[level(SDM, l, s)];
		azm[l] = state[level(SZM, l, s)];
		atm[l] = state[level(STM, l, s)];
		aqm[l] = state[level(SQM, l, s)];
		adt[l] = state[level(SDT, l, s)];
		stt[l] = state[level(STT, l, s)];
	}
	var zgt: array<f32, NLEV>;
	var zgm: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		var gt = 0.0;
		var gm = 0.0;
		for (var k = 0u; k < NLEV; k++) {
			gt = gt + tables[TABLE_G + l * NLEV + k] * stt[k];
			gm = gm + tables[TABLE_G + l * NLEV + k] * atm[k];
		}
		zgt[l] = gt;
		zgm[l] = gm;
	}
	var spt = state[SPT + s];
	let spm = apm;
	let sop = tables[TABLE_SOP + s];
	let jn = u32(tables[TABLE_NINDEX + s]);
	var sdt: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		var zsum = 0.0;
		if (jn > 0u) {
			let zq = 1.0 / f32(jn * (jn + 1u));
			for (var l2 = 0u; l2 < NLEV; l2++) {
				let z0 = tables[TABLE_T0 + l2];
				let zt = zgt[l2] - z0 * spt;
				let zm = zgm[l2] + z0 * spm;
				let za = adt[l2] * zq + sop;
				let zb = adm[l2] * zq;
				let zz = zb + DELT * (zm + za + DELT * zt);
				zsum = zsum + zz * tables[TABLE_BM1 + ((jn - 1u) * NLEV + l) * NLEV + l2];
			}
		}
		sdt[l] = select(zsum, 0.0, s < 2u);
	}
	for (var l = 0u; l < NLEV; l++) {
		spt = spt + tables[TABLE_DSIGMA + l] * sdt[l];
	}
	for (var l = 0u; l < NLEV; l++) {
		var tau = 0.0;
		for (var k = 0u; k < NLEV; k++) {
			tau = tau + tables[TABLE_TAU + l * NLEV + k] * sdt[k];
		}
		stt[l] = stt[l] - tau;
	}
	let spp = state[SPP + s];
	if (FILTER) {
		state[SPM + s] = PNU21 * spp + PNU * apm;
	}
	let sppNew = select(apm - DELT2 * spt, 0.0, s < 2u);
	state[SPP + s] = sppNew;
	state[SP + s] = sppNew;
	state[SPT + s] = spt;
	for (var l = 0u; l < NLEV; l++) {
		if (FILTER) {
			state[level(SDM, l, s)] = PNU21 * state[level(SDP, l, s)] + PNU * adm[l];
			state[level(SZM, l, s)] = PNU21 * state[level(SZP, l, s)] + PNU * azm[l];
			state[level(STM, l, s)] = PNU21 * state[level(STP, l, s)] + PNU * atm[l];
			state[level(SQM, l, s)] = PNU21 * state[level(SQP, l, s)] + PNU * aqm[l];
		}
		let sdp = 2.0 * sdt[l] - adm[l];
		let stp = DELT2 * stt[l] + atm[l];
		let szp = DELT2 * state[level(SZT, l, s)] + azm[l];
		let sqp = DELT2 * state[level(SQT, l, s)] + aqm[l];
		state[level(SDT, l, s)] = sdt[l];
		state[level(STT, l, s)] = stt[l];
		state[level(SDP, l, s)] = sdp;
		state[level(STP, l, s)] = stp;
		state[level(SZP, l, s)] = szp;
		state[level(SQP, l, s)] = sqp;
		state[level(SD, l, s)] = sdp;
		state[level(ST, l, s)] = stp;
		state[level(SZ, l, s)] = szp;
		state[level(SQ, l, s)] = sqp;
	}
}
